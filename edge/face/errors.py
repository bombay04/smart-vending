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


class NoFaceError(FaceEngineError):
    code = "NO_FACE"


class MultipleFacesError(FaceEngineError):
    code = "MULTIPLE_FACES"


class TemplateStorageError(FaceEngineError):
    code = "TEMPLATE_ERROR"


class TemplateNotFoundError(TemplateStorageError):
    pass


class CorruptTemplateError(TemplateStorageError):
    pass


class IncompatibleTemplateError(TemplateStorageError):
    pass
