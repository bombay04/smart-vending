"""Command-line interface for Pi-side face registration and recognition."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .camera import probe_camera_indices
from .config import (
    DEFAULT_CAMERA_INDEX,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    DEFAULT_ENROLLMENT_SAMPLE_COUNT,
    DEFAULT_LIVE_SAMPLE_COUNT,
    DEFAULT_SFACE_L2_DISTANCE_THRESHOLD,
    DEFAULT_TEMPLATE_DIRECTORY,
)
from .engine import FaceEngine
from .diagnostics import DiagnosticEvent, format_diagnostic
from .errors import FaceEngineError
from .storage import TemplateStore


EXIT_SUCCESS = 0
EXIT_NO_MATCH = 1
EXIT_OPERATIONAL_ERROR = 2


def _environment_integer(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error


def _environment_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number.") from error


def _template_directory() -> Path:
    configured = os.getenv("FACE_TEMPLATE_DIR")
    return Path(configured) if configured else DEFAULT_TEMPLATE_DIRECTORY


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prototype Raspberry Pi face registration and recognition."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    register_parser = subparsers.add_parser(
        "register", help="Capture and register exactly one face."
    )
    register_parser.add_argument("--employee-code", required=True)
    register_parser.add_argument(
        "--camera-index",
        type=int,
        default=_environment_integer("FACE_CAMERA_INDEX", DEFAULT_CAMERA_INDEX),
    )
    register_parser.add_argument(
        "--template-dir", type=Path, default=_template_directory()
    )
    register_parser.add_argument(
        "--stabilization-seconds",
        type=float,
        default=_environment_float(
            "FACE_CAMERA_STABILIZATION_SECONDS",
            DEFAULT_CAMERA_STABILIZATION_SECONDS,
        ),
    )
    register_parser.add_argument(
        "--enrollment-samples",
        type=int,
        default=_environment_integer(
            "FACE_ENROLLMENT_SAMPLES", DEFAULT_ENROLLMENT_SAMPLE_COUNT
        ),
    )
    register_parser.add_argument(
        "--debug",
        action="store_true",
        help="Print privacy-safe capture, detection, embedding, and timing diagnostics.",
    )

    recognize_parser = subparsers.add_parser(
        "recognize", help="Capture and compare exactly one face."
    )
    recognize_parser.add_argument(
        "--camera-index",
        type=int,
        default=_environment_integer("FACE_CAMERA_INDEX", DEFAULT_CAMERA_INDEX),
    )
    recognize_parser.add_argument(
        "--sface-l2-threshold",
        dest="sface_l2_threshold",
        type=float,
        default=_environment_float(
            "FACE_SFACE_L2_THRESHOLD", DEFAULT_SFACE_L2_DISTANCE_THRESHOLD
        ),
        help="Uncalibrated SFace FR_NORM_L2 threshold; lower is more similar.",
    )
    recognize_parser.add_argument(
        "--template-dir", type=Path, default=_template_directory()
    )
    recognize_parser.add_argument(
        "--stabilization-seconds",
        type=float,
        default=_environment_float(
            "FACE_CAMERA_STABILIZATION_SECONDS",
            DEFAULT_CAMERA_STABILIZATION_SECONDS,
        ),
    )
    recognize_parser.add_argument(
        "--live-samples",
        type=int,
        default=_environment_integer("FACE_LIVE_SAMPLES", DEFAULT_LIVE_SAMPLE_COUNT),
    )
    recognize_parser.add_argument(
        "--debug",
        action="store_true",
        help="Print privacy-safe capture, detection, embedding, and timing diagnostics.",
    )

    probe_parser = subparsers.add_parser(
        "probe-camera", help="Find indices that open and capture a frame."
    )
    probe_parser.add_argument("--start-index", type=int, default=0)
    probe_parser.add_argument("--max-index", type=int, default=10)
    return parser


def _create_engine(args: argparse.Namespace) -> FaceEngine:
    return FaceEngine(
        camera_index=args.camera_index,
        sface_l2_threshold=getattr(
            args, "sface_l2_threshold", DEFAULT_SFACE_L2_DISTANCE_THRESHOLD
        ),
        stabilization_seconds=args.stabilization_seconds,
        enrollment_sample_count=getattr(
            args, "enrollment_samples", DEFAULT_ENROLLMENT_SAMPLE_COUNT
        ),
        live_sample_count=getattr(args, "live_samples", DEFAULT_LIVE_SAMPLE_COUNT),
        template_store=TemplateStore(args.template_dir),
        diagnostic_sink=_print_diagnostic if args.debug else None,
    )


def _print_diagnostic(event: DiagnosticEvent) -> None:
    print(format_diagnostic(event), file=sys.stderr)


def run(args: argparse.Namespace) -> int:
    if args.command == "probe-camera":
        results = probe_camera_indices(args.start_index, args.max_index)
        usable_indices = []
        for result in results:
            if result.captured_frame:
                usable_indices.append(result.camera_index)
                print(f"CAMERA_OK index={result.camera_index}")
            elif result.opened:
                print(f"CAMERA_NO_FRAME index={result.camera_index}")
            else:
                print(f"CAMERA_UNAVAILABLE index={result.camera_index}")
        if not usable_indices:
            print("CAMERA_ERROR no camera index returned a frame", file=sys.stderr)
            return EXIT_OPERATIONAL_ERROR
        return EXIT_SUCCESS

    engine = _create_engine(args)
    if args.command == "register":
        template = engine.register(args.employee_code)
        print(
            f"REGISTERED employeeCode={template.employee_code} "
            f"samples={len(template.embeddings)}"
        )
        return EXIT_SUCCESS

    result = engine.recognize()
    if result.matched:
        print(
            f"MATCH employeeCode={result.employee_code} "
            f"distance={result.distance:.6f} threshold={result.threshold:.6f} "
            f"liveSamples={len(result.sample_distances)}"
        )
        return EXIT_SUCCESS
    print(
        f"NO_MATCH distance={result.distance:.6f} "
        f"threshold={result.threshold:.6f} "
        f"passedSamples={sum(distance <= result.threshold for distance in result.sample_distances)}"
        f"/{len(result.sample_distances)}"
    )
    return EXIT_NO_MATCH


def main() -> int:
    try:
        return run(build_parser().parse_args())
    except FaceEngineError as error:
        print(f"{error.code} {error}", file=sys.stderr)
        return EXIT_OPERATIONAL_ERROR
    except ValueError as error:
        print(f"CONFIG_ERROR {error}", file=sys.stderr)
        return EXIT_OPERATIONAL_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
