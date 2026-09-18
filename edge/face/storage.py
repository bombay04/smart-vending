"""Local JSON persistence for prototype face templates only."""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .config import (
    DEFAULT_TEMPLATE_DIRECTORY,
    MAX_ENROLLMENT_SAMPLE_COUNT,
    MIN_ENROLLMENT_SAMPLE_COUNT,
    SFACE_ALGORITHM,
    SFACE_EMBEDDING_LENGTH,
    SFACE_MODEL_FILENAME,
    SFACE_SIMILARITY_METRIC,
    YUNET_MODEL_FILENAME,
)
from .errors import (
    CorruptTemplateError,
    IncompatibleTemplateError,
    TemplateNotFoundError,
    TemplateStorageError,
)
from .models import FaceTemplate


TEMPLATE_SCHEMA_VERSION = 3
EMPLOYEE_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class TemplateStore:
    def __init__(self, directory: Path = DEFAULT_TEMPLATE_DIRECTORY) -> None:
        self.directory = Path(directory)

    def _path_for(self, employee_code: str) -> Path:
        if not EMPLOYEE_CODE_PATTERN.fullmatch(employee_code):
            raise TemplateStorageError(
                "employeeCode must use 1-64 letters, digits, underscores, or hyphens."
            )
        return self.directory / f"{employee_code}.json"

    def save(self, template: FaceTemplate) -> Path:
        path = self._path_for(template.employee_code)
        self._validate_template(template, path)
        self.directory.mkdir(parents=True, exist_ok=True)
        document = {
            "schemaVersion": TEMPLATE_SCHEMA_VERSION,
            "employeeCode": template.employee_code,
            "algorithm": template.algorithm,
            "similarityMetric": template.similarity_metric,
            "detectorModel": template.detector_model,
            "embeddingModel": template.embedding_model,
            "embeddings": [
                list(embedding) for embedding in template.embeddings
            ],
        }

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.directory,
                prefix=f".{template.employee_code}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(document, temporary_file, separators=(",", ":"))
                temporary_file.write("\n")
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, path)
        except OSError as error:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise TemplateStorageError(f"Unable to save template: {path}") from error
        return path

    def load(self, employee_code: str) -> FaceTemplate:
        path = self._path_for(employee_code)
        if not path.is_file():
            raise TemplateNotFoundError(
                f"No face template is registered for employeeCode {employee_code}."
            )
        return self._load_path(path)

    def load_all(self) -> list[FaceTemplate]:
        if not self.directory.is_dir():
            raise TemplateNotFoundError("No face templates are registered.")
        paths = sorted(self.directory.glob("*.json"))
        if not paths:
            raise TemplateNotFoundError("No face templates are registered.")
        return [self._load_path(path) for path in paths]

    def _load_path(self, path: Path) -> FaceTemplate:
        try:
            document: Any = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(document, dict):
                raise ValueError("Template root must be an object.")
            schema_version = document.get("schemaVersion")
            if type(schema_version) is not int:
                raise ValueError("Invalid template schema version.")
            if schema_version != TEMPLATE_SCHEMA_VERSION:
                raise IncompatibleTemplateError(
                    f"Face template {path.name} uses schema {schema_version!r}; "
                    f"schema {TEMPLATE_SCHEMA_VERSION} YuNet/SFace enrollment is "
                    "required. Re-register the employee; LBP templates cannot be "
                    "migrated automatically."
                )
            employee_code = document.get("employeeCode")
            algorithm = document.get("algorithm")
            similarity_metric = document.get("similarityMetric")
            detector_model = document.get("detectorModel")
            embedding_model = document.get("embeddingModel")
            raw_embeddings = document.get("embeddings")
            if not all(
                isinstance(value, str)
                for value in (
                    employee_code,
                    algorithm,
                    similarity_metric,
                    detector_model,
                    embedding_model,
                )
            ):
                raise ValueError("Invalid template identity fields.")
            if not isinstance(raw_embeddings, list):
                raise ValueError("Invalid template embeddings.")
            embeddings = tuple(
                tuple(float(value) for value in raw_embedding)
                for raw_embedding in raw_embeddings
                if isinstance(raw_embedding, list)
            )
            if len(embeddings) != len(raw_embeddings):
                raise ValueError("Invalid enrollment embedding collection.")
            template = FaceTemplate(
                employee_code=employee_code,
                algorithm=algorithm,
                similarity_metric=similarity_metric,
                detector_model=detector_model,
                embedding_model=embedding_model,
                embeddings=embeddings,
            )
            if path != self._path_for(employee_code):
                raise ValueError("Template filename does not match employeeCode.")
            self._validate_template(template, path)
            return template
        except (
            OSError,
            OverflowError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
        ) as error:
            raise CorruptTemplateError(f"Invalid face template: {path.name}") from error

    @staticmethod
    def _validate_template(template: FaceTemplate, path: Path) -> None:
        if (
            template.algorithm != SFACE_ALGORITHM
            or template.similarity_metric != SFACE_SIMILARITY_METRIC
            or template.detector_model != YUNET_MODEL_FILENAME
            or template.embedding_model != SFACE_MODEL_FILENAME
        ):
            raise IncompatibleTemplateError(
                f"Unsupported face model or metric in template: {path.name}"
            )
        if not (
            MIN_ENROLLMENT_SAMPLE_COUNT
            <= len(template.embeddings)
            <= MAX_ENROLLMENT_SAMPLE_COUNT
        ):
            raise CorruptTemplateError(
                f"Invalid enrollment sample count in template: {path.name}"
            )
        for embedding in template.embeddings:
            if len(embedding) != SFACE_EMBEDDING_LENGTH:
                raise CorruptTemplateError(
                    f"Invalid embedding length in template: {path.name}"
                )
            norm_squared = sum(value * value for value in embedding)
            if (
                any(not math.isfinite(value) for value in embedding)
                or not math.isfinite(norm_squared)
                or norm_squared <= 0.0
            ):
                raise CorruptTemplateError(
                    f"Invalid embedding values in template: {path.name}"
                )
