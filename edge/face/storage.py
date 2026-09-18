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
    REPRESENTATION_ALGORITHM,
    REPRESENTATION_LENGTH,
)
from .errors import CorruptTemplateError, TemplateNotFoundError, TemplateStorageError
from .models import FaceTemplate


TEMPLATE_SCHEMA_VERSION = 1
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
            "representation": list(template.representation),
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
            if document.get("schemaVersion") != TEMPLATE_SCHEMA_VERSION:
                raise ValueError("Unsupported template schema version.")
            employee_code = document.get("employeeCode")
            algorithm = document.get("algorithm")
            raw_representation = document.get("representation")
            if not isinstance(employee_code, str) or not isinstance(algorithm, str):
                raise ValueError("Invalid template identity fields.")
            if not isinstance(raw_representation, list):
                raise ValueError("Invalid template representation.")
            representation = tuple(float(value) for value in raw_representation)
            template = FaceTemplate(employee_code, algorithm, representation)
            if path != self._path_for(employee_code):
                raise ValueError("Template filename does not match employeeCode.")
            self._validate_template(template, path)
            return template
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise CorruptTemplateError(f"Invalid face template: {path.name}") from error

    @staticmethod
    def _validate_template(template: FaceTemplate, path: Path) -> None:
        if template.algorithm != REPRESENTATION_ALGORITHM:
            raise CorruptTemplateError(
                f"Unsupported face representation in template: {path.name}"
            )
        if len(template.representation) != REPRESENTATION_LENGTH:
            raise CorruptTemplateError(
                f"Invalid representation length in template: {path.name}"
            )
        if any(
            not math.isfinite(value) or value < 0.0
            for value in template.representation
        ):
            raise CorruptTemplateError(
                f"Invalid representation values in template: {path.name}"
            )

