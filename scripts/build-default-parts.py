#!/usr/bin/env python3
"""Repackage eligible physical parts from the pinned, reviewed snapshot.

No network requests, tracker updates, inferred catalog IDs or geometry edits.
Run explicitly when maintaining the versioned default distribution.
"""
import collections
import gzip
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "artifacts/brickbuilder-mobile"
VERSION = "2026-11-17"
OFFICIAL = "https://library.ldraw.org/library/official/"
UNOFFICIAL = "https://library.ldraw.org/library/unofficial/"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


raw = (APP / "public/parts/import-geometry-2026-10-31.bin").read_bytes()
assert sha(raw) == "32911d11322d15d1db02dac54aab541a3c8def0ef11de1152a2313520c5894cf"
snapshot = json.loads(gzip.decompress(raw))
files = {f["path"]: f for f in snapshot["files"]}
catalog_path = APP / "src/features/parts/catalog.json"
originals = [p for p in json.loads(catalog_path.read_text()) if p["id"] in ("ldraw-bricks", "ldraw-plates")]
excluded = set()
for manifest in originals:
    package = json.loads((APP / "public" / manifest["url"]).read_bytes())
    excluded.update(p["ldrawId"] for p in package["parts"])
    # Existing approved geometries take precedence, exactly as in the application.
    files.update({f["path"]: f for f in package["files"]})
    for part in package["parts"]:
        text = files[part["file"]]["content"]
        moved = re.search(r"^0 ~Moved to (\S+)", text, re.M)
        if moved:
            excluded.add(moved[1].strip())

groups = {
    "bricks": ("Steine", ["Brick"]),
    "plates": ("Platten", ["Plate", "Baseplate"]),
    "tiles": ("Fliesen", ["Tile"]),
    "slopes": ("Schrägsteine", ["Slope", "Wedge", "Wing", "Arch", "Cone"]),
    "technic": ("Technik", ["Technic", "Bar", "Hinge", "Bracket"]),
    "details": ("Fahrzeug & Details", ["Car", "Wheel", "Tyre", "Door", "Window", "Panel",
                                         "Windscreen", "Glass", "Tail", "Container",
                                         "Fence", "Support", "Vehicle", "Plant"]),
}


def references(content):
    for line in content.splitlines():
        if re.match(r"^1\s", line):
            ref = " ".join(line.split()[14:]).replace("\\", "/").lower()
            assert ".." not in ref
            yield ref


def closure(path, collected=None, chain=()):
    collected = collected if collected is not None else set()
    assert path not in chain and len(chain) < 48, path
    if path in collected:
        return collected
    file = files[path]
    assert file["sourceUrl"] in (OFFICIAL + path, UNOFFICIAL + path), path
    assert file["author"] and file["license"] in ("CC-BY-4.0", "CC0-1.0"), path
    assert f"0 Author: {file['author']}" in file["content"].splitlines(), path
    license_name = "CC0" if file["license"] == "CC0-1.0" else "CC BY 4.0"
    assert any(line in (
        f"0 !LICENSE Licensed under {license_name} : see CAreadme.txt",
        "0 !LICENSE Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt",
    ) for line in file["content"].splitlines()), path
    for ref in references(file["content"]):
        child = next((prefix + ref for prefix in ("parts/", "p/") if prefix + ref in files), None)
        assert child, (path, ref)
        closure(child, collected, (*chain, path))
    collected.add(path)
    return collected


candidates = collections.defaultdict(list)
for path, file in sorted(files.items()):
    if not re.fullmatch(r"parts/[a-z0-9_-]+\.dat", path):
        continue
    part_id = pathlib.PurePosixPath(path).stem
    text = file["content"]
    name = re.sub(r"\s+", " ", text.splitlines()[0][2:]).strip()
    if part_id in excluded or not name or name[0] in "~=":
        continue
    # Physical top-level parts only; aliases, shortcuts, flexible sections,
    # patterned/decorated variants and primitives do not inflate coverage.
    if not re.search(r"^0 !LDRAW_ORG (?:Unofficial_)?Part(?: UPDATE[^\r\n]*)?\r?$", text, re.M):
        continue
    if re.search(r"Pattern|Sticker|Flexible", name, re.I):
        continue
    group = next((key for key, (_, prefixes) in groups.items() if name.split()[0] in prefixes), None)
    if group:
        closure(path)  # Fail explicitly on an unsupported source/license/dependency.
        candidates[group].append((file["sourceUrl"].startswith(UNOFFICIAL), part_id, name, path))

# Include every eligible root in these six categories, official roots first.
selected = collections.defaultdict(list)
for unofficial in (False, True):
    queues = {key: [p for p in sorted(candidates[key]) if p[0] == unofficial] for key in groups}
    while any(queues.values()):
        for key in groups:
            if queues[key]:
                selected[key].append(queues[key].pop(0))
assert sum(map(len, selected.values())) == 357, "Reviewed physical-part coverage changed; inspect the source snapshot"

manifests = []
coverage = {}
for key, (category, _) in groups.items():
    package_id = f"ldraw-default-{key}"
    paths = set()
    parts = []
    for unofficial, part_id, name, path in selected[key]:
        closure(path, paths)
        parts.append(dict(id=f"{package_id}:{part_id}", packageId=package_id, ldrawId=part_id,
                          name=name, category=category, keywords=[category, *name.lower().split()], file=path))
    package_files = []
    for path in sorted(paths):
        file = files[path].copy()
        content = file["content"].encode()
        file.update(sha256=sha(content), byteLength=len(content))
        package_files.append(file)
    legal = snapshot["legalDocuments"]
    if any(f["license"] == "CC0-1.0" for f in package_files):
        assert any("CC0" in d["name"] for d in legal)
    payload = dict(id=package_id, version=VERSION, parts=parts, files=package_files, legalDocuments=legal)
    encoded = encode(payload)
    compressed = gzip.compress(encoded, mtime=0)
    url = f"parts/{package_id}-{VERSION}.bin"
    (APP / "public" / url).write_bytes(compressed)
    authors = sorted(set(f["author"] for f in package_files))
    manifests.append(dict(id=package_id, version=VERSION, title=f"LDraw · {category} · Basis",
                          description=f"{len(parts)} zusätzliche, geprüfte Bauteile. Automatisch offline verfügbar.",
                          url=url, sha256=sha(compressed), bytes=len(compressed), partCount=len(parts),
                          fileCount=len(package_files), sourceUrl=OFFICIAL,
                          licenseUrl="https://creativecommons.org/licenses/by/4.0/",
                          licenses=sorted(set(f["license"] for f in package_files)),
                          attribution="; ".join(authors),
                          changes="Originaldateien unverändert aus dem geprüften Import-Snapshot; Auswahl, Paketierung und Suchmetadaten durch BrickBuilder.",
                          compression="gzip", bundled=True))
    coverage[key] = dict(parts=len(parts), official=sum(not p[0] for p in selected[key]),
                         bytes=len(compressed), expandedBytes=len(encoded), files=len(paths),
                         ids=[p["ldrawId"] for p in parts])
for original in originals:
    original["bundled"] = True
catalog_path.write_text(json.dumps(originals + manifests, ensure_ascii=False, indent=2) + "\n")
report = dict(version=VERSION, sourceSha256=sha(raw), addedPhysicalParts=sum(map(len, selected.values())),
              addedBundleBytes=sum(p["bytes"] for p in manifests),
              expandedPackageBytes=sum(g["expandedBytes"] for g in coverage.values()), packages=coverage)
(APP / "docs/default-parts-coverage.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
