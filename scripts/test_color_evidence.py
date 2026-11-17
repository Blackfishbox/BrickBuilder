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
    def sources(self, root, overrides=None):
        rows = {
            "parts": [["p", "Part", "1", "Plastic"], ["pp01", "Print", "1", "Plastic"]],
            "colors": [["0", "Black", "000000", "False", "1", "1", "2000", "2026"],
                       ["-1", "[Unknown]", "000000", "False", "1", "1", "", ""]],
            "elements": [["e1", "p", "0", ""], ["e2", "p", "0", ""], ["e3", "pp01", "-1", ""],
                         ["e4", "orphan", "0", ""]],
            "part_mappings": [["p", "LD", "p", "True", "True"], ["pp01", "LD", "pp01", "True", "True"]],
            "color_mappings": [["0", "LD", "0", "[]", "True", "True"]],
            "sets": [["set-1", "Set", "2000", "1", "1", ""]],
            "minifigs": [["fig-1", "Minifigure", "1", ""]],
            "inventories": [["1", "1", "set-1"], ["2", "1", "fig-1"]],
            "inventory_parts": [["1", "p", "0", "1", "False", ""]],
        }
        rows.update(overrides or {})
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
            self.assertEqual(payload["pairsBySource"], {
                "elements": {"p": ["0"]}, "setInventories": {"p": ["0"]}, "minifigInventories": {}})
            self.assertEqual(manifest["coverage"]["excludedUnknownColorRows"], 1)
            self.assertEqual(manifest["coverage"]["excludedMissingPartRows"], [["e4", "orphan", "0"]])
            self.assertEqual(builder.build(root, "test", "2026-11-16"), manifest)

    def test_observes_exact_inventory_pairs_with_separate_official_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.sources(root, {
                "inventories": [["1", "1", "set-1"], ["2", "1", "fig-1"],
                                ["3", "2", "set-1"], ["4", "1", "MOC-unverified"]],
                "inventory_parts": [
                    ["1", "pp01", "0", "2", "True", ""],  # Spare is still observed.
                    ["2", "pp01", "0", "1", "False", ""],
                    ["3", "pp01", "0", "1", "False", ""],  # Another published version.
                    ["1", "p", "-1", "1", "False", ""],
                    ["1", "absent", "0", "1", "False", ""],
                    ["4", "p", "0", "1", "False", ""]],
            })
            manifest = builder.build(root, "test", "2026-11-16")
            data = json.loads(gzip.decompress((root / "part-colors.bin").read_bytes()))
            self.assertEqual(data["schema"], 2)
            self.assertEqual(data["pairs"], {"p": ["0"], "pp01": ["0"]})
            self.assertEqual(data["pairsBySource"]["elements"], {"p": ["0"]})
            self.assertEqual(data["pairsBySource"]["setInventories"], {"pp01": ["0"]})
            self.assertEqual(data["pairsBySource"]["minifigInventories"], {"pp01": ["0"]})
            coverage = manifest["coverage"]
            self.assertEqual(coverage["additionalPairsBeyondElements"], 1)
            self.assertEqual(coverage["acceptedInventoryRows"], {"setInventories": 2, "minifigInventories": 1})
            self.assertEqual(coverage["excludedInventoryRows"],
                             {"unknownColorRows": 1, "missingPartRows": 1, "missingOwnerRows": 1})
            self.assertEqual(len(coverage["inventoriesWithoutOfficialOwner"]), 1)
            self.assertEqual(builder.build(root, "test", "2026-11-16"), manifest)

    def test_rejects_invalid_inventory_rows_instead_of_guessing(self):
        invalid = [
            ["999", "p", "0", "1", "False", ""],
            ["1", "p", "999", "1", "False", ""],
            ["1", "p", "0", "0", "False", ""],
            ["1", "p", "0", "-1", "False", ""],
            ["1", "p", "0", "1", "maybe", ""],
        ]
        for row in invalid:
            with self.subTest(row=row), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.sources(root, {"inventory_parts": [row]})
                with self.assertRaisesRegex(ValueError, "Invalid inventory"):
                    builder.build(root, "test", "2026-11-16")

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
        generated = json.loads((source / "coverage-report.json").read_text())
        self.assertEqual(generated, json.loads((builder.APP / "docs/part-color-coverage.json").read_text()))
        # Every newly covered exact ID has auditable row witnesses, not aliases.
        wanted = {w["csvRow"] for evidence in generated["additionalCoverage"]["evidence"].values()
                  for color in evidence["colors"] for w in color["observations"]}
        rows = {}
        with gzip.open(source / "inventory_parts.csv.gz", "rt") as stream:
            for line, row in enumerate(csv.DictReader(stream), start=2):
                if line in wanted:
                    rows[line] = (row["inventory_id"], row["part_num"], row["color_id"])
        for evidence in generated["additionalCoverage"]["evidence"].values():
            for color in evidence["colors"]:
                self.assertTrue(color["observations"])
                for witness in color["observations"]:
                    self.assertEqual(rows[witness["csvRow"]],
                                     (witness["inventoryId"], evidence["rebrickableId"], color["rebrickableColor"]))


if __name__ == "__main__":
    unittest.main()
