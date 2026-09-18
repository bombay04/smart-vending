"""Configuration constants for the prototype face engine."""

from __future__ import annotations

from pathlib import Path


DEFAULT_CAMERA_INDEX = 0
DEFAULT_CAPTURE_WIDTH = 640
DEFAULT_CAPTURE_HEIGHT = 480
DEFAULT_WARMUP_FRAMES = 5

FACE_WIDTH = 96
FACE_HEIGHT = 96
LBP_GRID_ROWS = 8
LBP_GRID_COLUMNS = 8
LBP_BIN_COUNT = 59
REPRESENTATION_LENGTH = LBP_GRID_ROWS * LBP_GRID_COLUMNS * LBP_BIN_COUNT
REPRESENTATION_ALGORITHM = "spatial-uniform-lbp-v1"

# Prototype value only. Calibrate this on captures from the deployed Pi camera.
DEFAULT_MATCH_DISTANCE_THRESHOLD = 0.35

HAAR_SCALE_FACTOR = 1.1
HAAR_MIN_NEIGHBORS = 5
HAAR_MIN_FACE_SIZE = 80
FACE_CROP_MARGIN_RATIO = 0.10

DEFAULT_TEMPLATE_DIRECTORY = Path(__file__).resolve().parent / "data" / "templates"

