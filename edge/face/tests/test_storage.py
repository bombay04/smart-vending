from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from edge.face.config import REPRESENTATION_ALGORITHM, REPRESENTATION_LENGTH
from edge.face.errors import CorruptTemplateError, TemplateNotFoundError
from edge.face.models import FaceTemplate
from edge.face.storage import TemplateStore


class TemplateStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.store = TemplateStore(self.directory)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_template_round_trip(self) -> None:
        template = FaceTemplate(
            employee_code="EMP001",
            algorithm=REPRESENTATION_ALGORITHM,
            representation=tuple(0.0 for _ in range(REPRESENTATION_LENGTH)),
        )
        self.store.save(template)
        self.assertEqual(self.store.load("EMP001"), template)

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

