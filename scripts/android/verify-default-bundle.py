#!/usr/bin/env python3
"""Verify offline building packages and color evidence inside a release AAB."""
import hashlib
import json
import pathlib
import sys
import zipfile

def verify_bundle(bundle, app):
    catalog = json.loads((app / "src/features/parts/catalog.json").read_text())
    evidence = json.loads(
        (app / "src/features/catalog/color-evidence-manifest.json").read_text()
    )
    mapping = json.loads((app / "src/features/catalog/manifest.json").read_text())
    if not mapping["url"].endswith(".bin"):
        raise ValueError("Mapping catalog must use a .bin asset path, not an HTML5 route")
    mapping = {**mapping, "id": "mapping catalog"}
    count = 0
    with zipfile.ZipFile(bundle) as archive:
        # Check the packaged bytes, not just dist/public before Capacitor sync.
        for package in [mapping, evidence, *(p for p in catalog if p.get("bundled"))]:
            label = package.get("id", "part-color evidence")
            name = f"base/assets/public/{package['url']}"
            if archive.namelist().count(name) != 1:
                raise ValueError(f"Expected exactly one packaged asset: {label}")
            data = archive.read(name)
            if len(data) != package["bytes"]:
                raise ValueError(f"Packaged asset size mismatch: {label}")
            if hashlib.sha256(data).hexdigest() != package["sha256"]:
                raise ValueError(f"Packaged asset hash mismatch: {label}")
            count += package.get("partCount", 0)
        if count < 300:
            raise ValueError(f"Expected at least 300 selectable offline entries, got {count}")
        if "base/assets/public/sw.js" in archive.namelist():
            raise ValueError("Native bundle must not contain a PWA worker")
    return count, evidence["sha256"]


if __name__ == "__main__":
    app = pathlib.Path(__file__).resolve().parents[2] / "artifacts/brickbuilder-mobile"
    count, digest = verify_bundle(pathlib.Path(sys.argv[1]), app)
    print(
        f"Release AAB contains {count} selectable offline entries and verified "
        f"part-color evidence ({digest}), the verified .bin mapping catalog and no PWA worker."
    )
