#!/usr/bin/env python3
"""Verify the exact selectable offline package bytes inside a release AAB."""
import hashlib
import json
import pathlib
import sys
import zipfile

app = pathlib.Path(__file__).resolve().parents[2] / "artifacts/brickbuilder-mobile"
catalog = json.loads((app / "src/features/parts/catalog.json").read_text())
bundle = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(bundle) as archive:
    count = 0
    for package in catalog:
        if not package.get("bundled"):
            continue
        data = archive.read(f"base/assets/public/{package['url']}")
        assert len(data) == package["bytes"], package["id"]
        assert hashlib.sha256(data).hexdigest() == package["sha256"], package["id"]
        count += package["partCount"]
    assert count >= 300, count
    assert "base/assets/public/sw.js" not in archive.namelist()
print(f"Release AAB contains {count} selectable offline entries with matching hashes and no PWA worker.")
