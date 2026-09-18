from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from edge.face.config import (
    DEFAULT_ENROLLMENT_SAMPLE_COUNT,
    SFACE_ALGORITHM,
    SFACE_MODEL_FILENAME,
    SFACE_SIMILARITY_METRIC,
    YUNET_MODEL_FILENAME,
)
from edge.face.errors import (
    CorruptTemplateError,
    IncompatibleTemplateError,
    TemplateNotFoundError,
)
from edge.face.models import FaceTemplate
from edge.face.storage import TEMPLATE_SCHEMA_VERSION, TemplateStore


def embedding(value: float = 1.0) -> tuple[float, ...]:
    return (value,) + tuple(1.0 for _ in range(127))


def face_template() -> FaceTemplate:
    return FaceTemplate(
        employee_code="EMP001",
        algorithm=SFACE_ALGORITHM,
        similarity_metric=SFACE_SIMILARITY_METRIC,
        detector_model=YUNET_MODEL_FILENAME,
        embedding_model=SFACE_MODEL_FILENAME,
        embeddings=tuple(
            embedding(float(index + 1))
            for index in range(DEFAULT_ENROLLMENT_SAMPLE_COUNT)
        ),
    )


class TemplateStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.store = TemplateStore(self.directory)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_schema_v3_multi_embedding_template_round_trip(self) -> None:
        template = face_template()
        path = self.store.save(template)
        document = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(document["schemaVersion"], 3)
        self.assertEqual(TEMPLATE_SCHEMA_VERSION, 3)
        self.assertEqual(document["algorithm"], SFACE_ALGORITHM)
        self.assertEqual(document["similarityMetric"], SFACE_SIMILARITY_METRIC)
        self.assertEqual(document["detectorModel"], YUNET_MODEL_FILENAME)
        self.assertEqual(document["embeddingModel"], SFACE_MODEL_FILENAME)
        self.assertEqual(
            len(document["embeddings"]), DEFAULT_ENROLLMENT_SAMPLE_COUNT
        )
        for forbidden in ("image", "frame", "crop", "landmarks", "representations"):
            self.assertNotIn(forbidden, document)
        self.assertEqual(self.store.load("EMP001"), template)

    def test_schema_v2_lbp_template_is_explicitly_incompatible(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        document = {
            "schemaVersion": 2,
            "employeeCode": "EMP001",
            "algorithm": "spatial-uniform-lbp-square-v2",
            "representations": [[0.0] * 3776] * 5,
        }
        (self.directory / "EMP001.json").write_text(
            json.dumps(document), encoding="utf-8"
        )
        with self.assertRaisesRegex(
            IncompatibleTemplateError, "LBP templates cannot be migrated"
        ):
            self.store.load("EMP001")

    def test_incompatible_model_metadata_is_rejected(self) -> None:
        template = face_template()
        incompatible = FaceTemplate(
            employee_code=template.employee_code,
            algorithm="different-model",
            similarity_metric=template.similarity_metric,
            detector_model=template.detector_model,
            embedding_model=template.embedding_model,
            embeddings=template.embeddings,
        )
        with self.assertRaises(IncompatibleTemplateError):
            self.store.save(incompatible)

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
