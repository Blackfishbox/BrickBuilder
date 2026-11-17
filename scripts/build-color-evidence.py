#!/usr/bin/env python3
"""Build reviewed, deterministic catalog observations, never at app build time."""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

FILES = {
    "elements": ["element_id", "part_num", "color_id", "design_id"],
    "parts": ["part_num", "name", "part_cat_id", "part_material"],
    "colors": ["id", "name", "rgb", "is_trans", "num_parts", "num_sets", "y1", "y2"],
    "part_mappings": ["part_num", "ext_system", "ext_id", "is_export_id", "is_import_id"],
    "color_mappings": ["id", "ext_system", "ext_id", "ext_descr", "is_export_id", "is_import_id"],
    "sets": ["set_num", "name", "year", "theme_id", "num_parts", "img_url"],
    "minifigs": ["fig_num", "name", "num_parts", "img_url"],
    "inventories": ["id", "version", "set_num"],
    "inventory_parts": ["inventory_id", "part_num", "color_id", "quantity", "is_spare", "img_url"],
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


def source_rows(directory, name, download, sources):
    """Iterate large inventories without retaining millions of CSV rows."""
    columns = FILES[name]
    path = directory / f"{name}.csv.gz"
    url = f"https://cdn.rebrickable.com/media/downloads/{name}.csv.gz"
    if download:
        with urlopen(url, timeout=120) as response:
            raw = response.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise ValueError("Source download exceeds limit")
        path.write_bytes(raw)
    raw = path.read_bytes()
    decoded_hash = hashlib.sha256()
    count = 0
    with gzip.open(path, "rb") as compressed:
        def lines():
            decoded_size = 0
            for line in compressed:
                decoded_size += len(line)
                if decoded_size > 512 * 1024 * 1024:
                    raise ValueError("Decoded source exceeds limit")
                decoded_hash.update(line)
                yield line.decode("utf-8-sig")
        reader = csv.reader(lines())
        if next(reader) != columns:
            raise ValueError(f"Unexpected CSV schema: {name}")
        for row in reader:
            if len(row) != len(columns):
                raise ValueError(f"Incomplete row: {name}")
            count += 1
            yield row
    sources[name] = dict(url=url, sha256=digest(raw), decodedSha256=decoded_hash.hexdigest(),
                         rows=count, bytes=len(raw), columns=columns)


def ordered_pairs(pairs):
    return {part: sorted(values, key=int) for part, values in sorted(pairs.items())}


def build(directory, version, snapshot_date, download=False):
    directory.mkdir(parents=True, exist_ok=True)
    sources = {}
    data = {name: list(source_rows(directory, name, download, sources))
            for name in FILES if name != "inventory_parts"}
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
        schema=2, version=version, snapshotDate=snapshot_date,
        # Explicit namespaces and direction flags; retain ambiguity, not guesses.
        ldParts=sorted({(r[2].lower().removesuffix(".dat"), r[0])
                        for r in data["part_mappings"] if r[1] == "LD" and r[4] == "True"}),
        ldColors=sorted({(r[2], r[0], r[4], r[5])
                         for r in data["color_mappings"] if r[1] == "LD"}),
        pairs=ordered_pairs(pairs),
    )
    baseline = library_coverage(payload)
    target_ids = set(baseline["ids"]["noObservations"])
    target_parts = {rb for ld, rb in payload["ldParts"] if ld in target_ids}
    owners = {}
    for name, kind in [("sets", "setInventories"), ("minifigs", "minifigInventories")]:
        for row in data[name]:
            if not row[0] or row[0] in owners:
                raise ValueError("Duplicate or empty inventory owner")
            owners[row[0]] = kind
    inventories = {}
    missing_owners = []
    for inventory, revision, owner in data["inventories"]:
        if not inventory.isdecimal() or not revision.isdecimal() or int(revision) < 1 or inventory in inventories:
            raise ValueError("Invalid inventory identity/version")
        if owner not in owners:
            missing_owners.append(dict(inventoryId=inventory, owner=owner, version=revision))
        inventories[inventory] = (owners.get(owner), owner, revision)
    by_source = {"elements": ordered_pairs(pairs), "setInventories": {}, "minifigInventories": {}}
    witnesses = {}
    inventory_exclusions = {"unknownColorRows": 0, "missingPartRows": 0, "missingOwnerRows": 0}
    accepted_rows = {"setInventories": 0, "minifigInventories": 0}
    for line, (inventory, part, color, quantity, spare, _image) in enumerate(
            source_rows(directory, "inventory_parts", download, sources), start=2):
        if inventory not in inventories or color not in colors:
            raise ValueError(f"Invalid inventory foreign key at row {line}")
        if not quantity.isdecimal() or int(quantity) < 1 or spare not in ("True", "False"):
            raise ValueError(f"Invalid inventory quantity/spare at row {line}")
        kind, owner, revision = inventories[inventory]
        if kind is None:
            inventory_exclusions["missingOwnerRows"] += 1
            continue
        if part not in parts:
            inventory_exclusions["missingPartRows"] += 1
            continue
        if int(color) < 0:
            inventory_exclusions["unknownColorRows"] += 1
            continue
        by_source[kind].setdefault(part, set()).add(color)
        accepted_rows[kind] += 1
        pairs.setdefault(part, set()).add(color)
        if part in target_parts:
            witnesses.setdefault((part, color, kind), dict(
                source=kind, inventoryId=inventory, owner=owner, version=revision,
                csvRow=line, quantity=int(quantity), isSpare=spare == "True"))
    payload["pairs"] = ordered_pairs(pairs)
    payload["pairsBySource"] = {kind: ordered_pairs(values) for kind, values in by_source.items()}
    combined = library_coverage(payload)
    newly_known = sorted(set(combined["ids"]["known"]) - set(baseline["ids"]["known"]))
    new_evidence = {}
    for ld in newly_known:
        rb = next(rb for alias, rb in payload["ldParts"] if alias == ld)
        new_evidence[ld] = dict(rebrickableId=rb, colors=[
            dict(rebrickableColor=color, observations=[
                witnesses[(rb, color, kind)] for kind in ("setInventories", "minifigInventories")
                if (rb, color, kind) in witnesses])
            for color in payload["pairs"][rb]])
    source_coverage = {}
    source_library = {}
    element_pairs = {(p, c) for p, values in by_source["elements"].items() for c in values}
    for kind, values in by_source.items():
        observed = {(p, c) for p, colors_ in values.items() for c in colors_}
        source_coverage[kind] = dict(parts=len(values), pairs=len(observed),
                                    additionalPairsBeyondElements=len(observed - element_pairs))
        if kind != "elements":
            merged = {p: set(cs) for p, cs in by_source["elements"].items()}
            for part, colors_ in values.items():
                merged.setdefault(part, set()).update(colors_)
            measured = library_coverage({**payload, "pairs": ordered_pairs(merged)})
            source_library[kind] = dict(
                counts=measured["counts"],
                newlyKnownIds=sorted(set(measured["ids"]["known"]) - set(baseline["ids"]["known"])))
    packed = gzip.compress(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(), mtime=0)
    sha = digest(packed)
    manifest = dict(
        schema=1, version=version, snapshotDate=snapshot_date, sha256=sha, bytes=len(packed),
        url=f"catalog/part-colors-{sha}.bin", sources=sources,
        coverage=dict(parts=len(pairs), pairs=sum(map(len, pairs.values())),
                      excludedUnknownColorRows=excluded, excludedMissingPartRows=orphans,
                      bySource=source_coverage, acceptedInventoryRows=accepted_rows,
                      excludedInventoryRows=inventory_exclusions,
                      inventoriesWithoutOfficialOwner=missing_owners,
                      additionalPairsBeyondElements=sum(map(len, pairs.values())) - len(element_pairs)),
        attribution="Catalog element, official set/minifigure inventory and mapping data sourced from Rebrickable and its community (https://rebrickable.com/downloads/).",
        termsUrl="https://rebrickable.com/terms/", termsReviewed="2026-11-16",
        license="Rebrickable catalog use permission, terms sections 5.1 and 5.3; not a Creative Commons license.",
        scope="Observed element and official set/minifigure inventory part-color pairs only; includes positive-quantity spare rows and all published inventory versions. Not BrickLink stock, prices, or exhaustive historical availability. No MOCs, images, geometry or Studio resources.",
    )
    report = dict(version=version, snapshotDate=snapshot_date, sha256=sha,
                  defaultLibrary=combined, elementOnlyDefaultLibrary=baseline,
                  additionalCoverage=dict(newlyKnownIds=newly_known, newlyKnownCount=len(newly_known),
                                          percentagePoints=round(100 * len(newly_known) / combined["distinctIds"], 2),
                                          elementsPlusSource=source_library,
                                          evidence=new_evidence))
    (directory / "part-colors.bin").write_bytes(packed)
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (directory / "coverage-report.json").write_text(json.dumps(report, indent=2) + "\n")
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
        (APP / "docs/part-color-coverage.json").write_bytes((args.directory / "coverage-report.json").read_bytes())
    print(json.dumps(manifest, indent=2))
