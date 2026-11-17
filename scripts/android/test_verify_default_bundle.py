"""Small archive fixtures exercise release checks without SDK or private data."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location(
    "verify_default_bundle", pathlib.Path(__file__).with_name("verify-default-bundle.py")
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class VerifyDefaultBundleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = pathlib.Path(self.temp.name)
        self.bundle = self.app / "release.aab"
        self.evidence = b"frozen evidence"
        self.parts = b"frozen building package"
        self.entries = {
            "base/assets/public/api/catalog/snapshot/test/catalog.bin": b"frozen mapping catalog",
            "base/assets/public/catalog/evidence.bin": self.evidence,
            "base/assets/public/parts/building.bin": self.parts,
        }
        for name, data, extra in [
            ("catalog/manifest.json", b"frozen mapping catalog", {"url": "api/catalog/snapshot/test/catalog.bin"}),
            ("catalog/color-evidence-manifest.json", self.evidence, {"url": "catalog/evidence.bin"}),
            ("parts/catalog.json", self.parts, {
                "url": "parts/building.bin", "id": "building", "bundled": True, "partCount": 300,
            }),
        ]:
            manifest = {
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), **extra,
            }
            target = self.app / "src/features" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps([manifest] if name == "parts/catalog.json" else manifest))

    def verify(self):
        with zipfile.ZipFile(self.bundle, "w") as archive:
            for name, data in self.entries.items():
                archive.writestr(name, data)
        return verifier.verify_bundle(self.bundle, self.app)

    def test_accepts_exact_packaged_assets(self):
        self.assertEqual(self.verify(), (300, hashlib.sha256(self.evidence).hexdigest()))

    def test_rejects_missing_evidence_after_sync(self):
        del self.entries["base/assets/public/catalog/evidence.bin"]
        with self.assertRaisesRegex(ValueError, "exactly one.*evidence"):
            self.verify()

    def test_rejects_missing_mapping_catalog(self):
        del self.entries["base/assets/public/api/catalog/snapshot/test/catalog.bin"]
        with self.assertRaisesRegex(ValueError, "exactly one.*mapping catalog"):
            self.verify()

    def test_rejects_mapping_corruption(self):
        name = "base/assets/public/api/catalog/snapshot/test/catalog.bin"
        self.entries[name] = b"x" * len(self.entries[name])
        with self.assertRaisesRegex(ValueError, "hash mismatch.*mapping catalog"):
            self.verify()

    def test_rejects_extensionless_mapping_path(self):
        path = self.app / "src/features/catalog/manifest.json"
        manifest = json.loads(path.read_text())
        manifest["url"] = "api/catalog/snapshot/test"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "HTML5 route"):
            self.verify()

    def test_rejects_wrong_evidence_size(self):
        self.entries["base/assets/public/catalog/evidence.bin"] = b"truncated"
        with self.assertRaisesRegex(ValueError, "size mismatch.*evidence"):
            self.verify()

    def test_rejects_same_size_corruption(self):
        self.entries["base/assets/public/catalog/evidence.bin"] = b"x" * len(self.evidence)
        with self.assertRaisesRegex(ValueError, "hash mismatch.*evidence"):
            self.verify()

    def test_rejects_missing_building_package(self):
        del self.entries["base/assets/public/parts/building.bin"]
        with self.assertRaisesRegex(ValueError, "exactly one.*building"):
            self.verify()

    def test_rejects_pwa_worker(self):
        self.entries["base/assets/public/sw.js"] = b"worker"
        with self.assertRaisesRegex(ValueError, "PWA worker"):
            self.verify()

    def test_rejects_duplicate_evidence_entries(self):
        self.verify()
        with zipfile.ZipFile(self.bundle, "a") as archive, warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            archive.writestr("base/assets/public/catalog/evidence.bin", self.evidence)
        with self.assertRaisesRegex(ValueError, "exactly one.*evidence"):
            verifier.verify_bundle(self.bundle, self.app)


if __name__ == "__main__":
    unittest.main()
