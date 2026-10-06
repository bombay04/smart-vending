"""Typed errors with stable CLI status codes."""

from __future__ import annotations


class FaceEngineError(Exception):
    """Base error raised for expected face-engine failures."""

    code = "FACE_ERROR"


class DependencyError(FaceEngineError):
    code = "DEPENDENCY_ERROR"


class ModelError(FaceEngineError):
    code = "MODEL_ERROR"


class EmbeddingError(FaceEngineError):
    code = "EMBEDDING_ERROR"


class DetectionError(FaceEngineError):
    code = "DETECTION_ERROR"


class CameraError(FaceEngineError):
    code = "CAMERA_ERROR"

    def __init__(self, message: str, *, reason: str = "CAMERA_ERROR") -> None:
        super().__init__(message)
        self.reason = reason


class NoFaceError(FaceEngineError):
    code = "NO_FACE"


class MultipleFacesError(FaceEngineError):
    code = "MULTIPLE_FACES"


class TemplateStorageError(FaceEngineError):
    code = "TEMPLATE_ERROR"


class AlreadyRegisteredError(TemplateStorageError):
    code = "ALREADY_REGISTERED"


class DuplicateFaceError(FaceEngineError):
    code = "FACE_ALREADY_REGISTERED"

    def __init__(self, conflicting_employee_code: str) -> None:
        super().__init__("This face is already registered to another employee.")
        self.conflicting_employee_code = conflicting_employee_code


class TemplateNotFoundError(TemplateStorageError):
    pass


class CorruptTemplateError(TemplateStorageError):
    pass


class IncompatibleTemplateError(TemplateStorageError):
    pass
