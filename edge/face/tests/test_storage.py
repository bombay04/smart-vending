from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from edge.face.config import (
    DEFAULT_ENROLLMENT_SAMPLE_COUNT,
    REPRESENTATION_ALGORITHM,
    REPRESENTATION_LENGTH,
)
from edge.face.errors import (
    CorruptTemplateError,
    IncompatibleTemplateError,
    TemplateNotFoundError,
)
from edge.face.models import FaceTemplate
from edge.face.storage import TEMPLATE_SCHEMA_VERSION, TemplateStore


def empty_representation() -> tuple[float, ...]:
    return tuple(0.0 for _ in range(REPRESENTATION_LENGTH))


class TemplateStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.store = TemplateStore(self.directory)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_multi_sample_template_round_trip(self) -> None:
        template = FaceTemplate(
            employee_code="EMP001",
            algorithm=REPRESENTATION_ALGORITHM,
            representations=tuple(
                empty_representation()
                for _ in range(DEFAULT_ENROLLMENT_SAMPLE_COUNT)
            ),
        )
        path = self.store.save(template)
        document = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(document["schemaVersion"], TEMPLATE_SCHEMA_VERSION)
        self.assertEqual(
            len(document["representations"]), DEFAULT_ENROLLMENT_SAMPLE_COUNT
        )
        self.assertNotIn("representation", document)
        self.assertEqual(self.store.load("EMP001"), template)

    def test_old_single_sample_schema_is_rejected_as_incompatible(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        document = {
            "schemaVersion": 1,
            "employeeCode": "EMP001",
            "algorithm": "spatial-uniform-lbp-v1",
            "representation": list(empty_representation()),
        }
        (self.directory / "EMP001.json").write_text(
            json.dumps(document), encoding="utf-8"
        )
        with self.assertRaisesRegex(IncompatibleTemplateError, "Re-register"):
            self.store.load("EMP001")

    def test_missing_template(self) -> None:
        with self.assertRaises(TemplateNotFoundError):
            self.store.load("EMP001")
        with self.assertRaises(TemplateNotFoundError):
            self.store.load_all()

    def test_corrupt_template(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / "EMP001.json").write_text("{not-json", encoding="utf-8")
        with self.assertRaises(CorruptTemplateError):
            self.store.load("EMP001")


if __name__ == "__main__":
    unittest.main()
