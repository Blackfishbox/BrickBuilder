"""Offline evidence-generator regression and reproducibility checks."""
import csv
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("builder", Path(__file__).with_name("build-color-evidence.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ColorEvidenceBuildTests(unittest.TestCase):
    def sources(self, root):
        rows = {
            "parts": [["p", "Part", "1", "Plastic"], ["pp01", "Print", "1", "Plastic"]],
            "colors": [["0", "Black", "000000", "False", "1", "1", "2000", "2026"],
                       ["-1", "[Unknown]", "000000", "False", "1", "1", "", ""]],
            "elements": [["e1", "p", "0", ""], ["e2", "p", "0", ""], ["e3", "pp01", "-1", ""],
                         ["e4", "orphan", "0", ""]],
            "part_mappings": [["p", "LD", "p", "True", "True"], ["pp01", "LD", "pp01", "True", "True"]],
            "color_mappings": [["0", "LD", "0", "[]", "True", "True"]],
        }
        for name, columns in builder.FILES.items():
            stream = io.StringIO(newline="")
            writer = csv.writer(stream)
            writer.writerow(columns)
            writer.writerows(rows[name])
            (root / f"{name}.csv.gz").write_bytes(gzip.compress(stream.getvalue().encode(), mtime=0))

    def test_deduplicates_observations_without_filling_variants_or_unknown_colors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.sources(root)
            manifest = builder.build(root, "test", "2026-11-16")
            payload = json.loads(gzip.decompress((root / "part-colors.bin").read_bytes()))
            self.assertEqual(payload["pairs"], {"p": ["0"]})
            self.assertEqual(manifest["coverage"]["excludedUnknownColorRows"], 1)
            self.assertEqual(manifest["coverage"]["excludedMissingPartRows"], [["e4", "orphan", "0"]])
            self.assertEqual(builder.build(root, "test", "2026-11-16"), manifest)

    def test_rejects_bad_source_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.sources(root)
            (root / "elements.csv.gz").write_bytes(gzip.compress(b"wrong,columns\nx,y\n"))
            with self.assertRaisesRegex(ValueError, "Unexpected CSV schema"):
                builder.build(root, "test", "2026-11-16")

    def test_complete_reviewed_sources_reproduce_pinned_snapshot(self):
        source = builder.ROOT / "generated-artifacts/color-evidence-sources"
        if not (source / "elements.csv.gz").exists():
            self.skipTest("Reviewed complete downloads not present")
        pinned = json.loads((builder.APP / "src/features/catalog/color-evidence-manifest.json").read_text())
        self.assertEqual(builder.build(source, pinned["version"], pinned["snapshotDate"]), pinned)


if __name__ == "__main__":
    unittest.main()
