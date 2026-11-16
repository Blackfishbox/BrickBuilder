#!/usr/bin/env python3
"""Build a reviewed, deterministic element-color index, never at app build time."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

FILES = {
    "elements": ["element_id", "part_num", "color_id", "design_id"],
    "parts": ["part_num", "name", "part_cat_id", "part_material"],
    "colors": ["id", "name", "rgb", "is_trans", "num_parts", "num_sets", "y1", "y2"],
    "part_mappings": ["part_num", "ext_system", "ext_id", "is_export_id", "is_import_id"],
    "color_mappings": ["id", "ext_system", "ext_id", "ext_descr", "is_export_id", "is_import_id"],
}
ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "artifacts/brickbuilder-mobile"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def library_coverage(payload):
    """Measure exact bundled IDs; do not inflate coverage by stripping variants."""
    catalog = json.loads((APP / "src/features/parts/catalog.json").read_text())
    ids = []
    for package in catalog:
        if not package.get("bundled"):
            continue
        raw = (APP / "public" / package["url"]).read_bytes()
        if digest(raw) != package["sha256"]:
            raise ValueError("Default library package checksum mismatch")
        data = json.loads(gzip.decompress(raw) if package.get("compression") == "gzip" else raw)
        ids.extend(part["ldrawId"].lower().removesuffix(".dat") for part in data["parts"])
    mapping, imports = {}, {}
    for ld, rb in payload["ldParts"]:
        mapping.setdefault(ld, set()).add(rb)
    for ld, rb, _output, incoming in payload["ldColors"]:
        if incoming == "True":
            imports.setdefault(ld, set()).add(rb)
    usable = set()
    for ld, rb, output, _incoming in payload["ldColors"]:
        if output == "True" and imports.get(ld) == {rb} and ld not in ("16", "24"):
            usable.add(rb)
    groups = {k: [] for k in ["known", "knownWithoutDisplayColors", "ambiguous", "noObservations", "noMapping"]}
    for ld in sorted(set(ids)):
        candidates = mapping.get(ld, set())
        if len(candidates) > 1:
            status = "ambiguous"
        elif not candidates:
            status = "noMapping"
        else:
            colors = payload["pairs"].get(next(iter(candidates)), [])
            status = ("known" if any(c in usable for c in colors) else "knownWithoutDisplayColors") if colors else "noObservations"
        groups[status].append(ld)
    return dict(entries=len(ids), distinctIds=len(set(ids)),
                counts={k: len(v) for k, v in groups.items()}, ids=groups)


def build(directory, version, snapshot_date, download=False):
    directory.mkdir(parents=True, exist_ok=True)
    data, sources = {}, {}
    for name, columns in FILES.items():
        path = directory / f"{name}.csv.gz"
        url = f"https://cdn.rebrickable.com/media/downloads/{name}.csv.gz"
        if download:
            with urlopen(url, timeout=120) as response:
                raw = response.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024:
                raise ValueError("Source download exceeds limit")
            path.write_bytes(raw)
        raw = path.read_bytes()
        decoded = gzip.decompress(raw)
        reader = csv.reader(io.StringIO(decoded.decode("utf-8-sig"), newline=""))
        if next(reader) != columns:
            raise ValueError(f"Unexpected CSV schema: {name}")
        rows = list(reader)
        if any(len(row) != len(columns) for row in rows):
            raise ValueError(f"Incomplete row: {name}")
        data[name] = rows
        sources[name] = dict(url=url, sha256=digest(raw), decodedSha256=digest(decoded),
                             rows=len(rows), bytes=len(raw), columns=columns)
    parts = {r[0] for r in data["parts"]}
    colors = {r[0] for r in data["colors"]}
    if len(parts) != len(data["parts"]) or len(colors) != len(data["colors"]):
        raise ValueError("Duplicate primary key")
    for name, parents in [("part_mappings", parts), ("color_mappings", colors)]:
        if any(r[0] not in parents or any(f not in ("True", "False") for f in r[-2:])
               for r in data[name]):
            raise ValueError(f"Invalid mapping: {name}")
    pairs = {}
    excluded = 0
    orphans = []
    for element, part, color, _design in data["elements"]:
        if not element or color not in colors:
            raise ValueError("Invalid element foreign key")
        if part not in parts:
            orphans.append([element, part, color])
            continue
        # -1 is the explicit unknown sentinel, not an observed real color.
        if int(color) < 0:
            excluded += 1
            continue
        pairs.setdefault(part, set()).add(color)
    payload = dict(
        schema=1, version=version, snapshotDate=snapshot_date,
        # Explicit namespaces and direction flags; retain ambiguity, not guesses.
        ldParts=sorted({(r[2].lower().removesuffix(".dat"), r[0])
                        for r in data["part_mappings"] if r[1] == "LD" and r[4] == "True"}),
        ldColors=sorted({(r[2], r[0], r[4], r[5])
                         for r in data["color_mappings"] if r[1] == "LD"}),
        pairs={part: sorted(values, key=int) for part, values in sorted(pairs.items())},
    )
    packed = gzip.compress(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(), mtime=0)
    sha = digest(packed)
    manifest = dict(
        schema=1, version=version, snapshotDate=snapshot_date, sha256=sha, bytes=len(packed),
        url=f"catalog/part-colors-{sha}.bin", sources=sources,
        coverage=dict(parts=len(pairs), pairs=sum(map(len, pairs.values())),
                      excludedUnknownColorRows=excluded, excludedMissingPartRows=orphans),
        attribution="Element and mapping data sourced from Rebrickable and its community (https://rebrickable.com/downloads/).",
        termsUrl="https://rebrickable.com/terms/", termsReviewed="2026-11-16",
        license="Rebrickable catalog use permission, terms sections 5.1 and 5.3; not a Creative Commons license.",
        scope="Observed element part-color pairs only; not BrickLink stock, prices, or exhaustive historical availability. No MOCs, images, geometry or Studio resources.",
    )
    (directory / "part-colors.bin").write_bytes(packed)
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=ROOT / "generated-artifacts/color-evidence-sources")
    parser.add_argument("--version", required=True)
    parser.add_argument("--snapshot-date", required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--approve", action="store_true")
    args = parser.parse_args()
    manifest = build(args.directory, args.version, args.snapshot_date, args.download)
    if args.approve:
        target = APP / "public" / manifest["url"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((args.directory / "part-colors.bin").read_bytes())
        (APP / "src/features/catalog/color-evidence-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        payload = json.loads(gzip.decompress(target.read_bytes()))
        report = dict(version=manifest["version"], snapshotDate=manifest["snapshotDate"],
                      sha256=manifest["sha256"], defaultLibrary=library_coverage(payload))
        (APP / "docs/part-color-coverage.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
