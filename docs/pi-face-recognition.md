# Raspberry Pi Prototype Face Recognition

This isolated Pi-side tool registers and compares prototype employee face templates. It is not connected to frontend authentication, the backend, PostgreSQL, Restock Mode, or the ESP32 serial service. It is not production biometric security.

## Dependency installation

The project pins `opencv-python-headless==4.13.0.92`. PyPI provides a prebuilt `cp37-abi3` ARM64 wheel compatible with the Pi's Debian 13, AArch64, and CPython 3.13 environment. The headless package retains camera/video support but omits GUI dependencies that this CLI does not use.

Activate the existing virtual environment without recreating it, then require wheels for every dependency so pip cannot compile OpenCV or NumPy from source:

```bash
cd ~/smart-vending
source .venv/bin/activate
python -m pip install --only-binary=:all: -r edge/requirements.txt
```

Confirm the installed version:

```bash
python -c "import cv2; print(cv2.__version__)"
```

## Find a usable camera index

Linux can expose several `/dev/video*` nodes for one physical device. Probe integer indices and require both a successful open and a captured frame:

```bash
python -m edge.face.cli probe-camera --start-index 0 --max-index 10
```

Use an index reported as `CAMERA_OK`. `CAMERA_NO_FRAME` means the node opened but did not deliver an image, and `CAMERA_UNAVAILABLE` means it did not open.

## Register EMP001

Only one usable frontal face may be visible:

```bash
python -m edge.face.cli register --employee-code EMP001 --camera-index 0
```

Registration collects five separately captured usable faces by default and saves five generated representations. Each capture performs camera stabilization again; one frame is never copied five times. It does not save captured frames or face crops. Re-registering the same employee code replaces that local prototype template.

The count can be adjusted conservatively between 3 and 10 when needed:

```bash
python -m edge.face.cli register --employee-code EMP001 --camera-index 0 --enrollment-samples 5
```

## Recognize

```bash
python -m edge.face.cli recognize --camera-index 0
```

Success output is either:

```text
MATCH employeeCode=EMP001 distance=0.123456 threshold=0.350000 liveSamples=3
```

or:

```text
NO_MATCH distance=0.500000 threshold=0.350000 passedSamples=2/3
```

`NO_MATCH` exits with status 1. Operational errors such as `NO_FACE`, `MULTIPLE_FACES`, `CAMERA_ERROR`, and `TEMPLATE_ERROR` exit with status 2 and remain distinguishable from a valid non-match.

Recognition collects three live samples by default. Every live sample must pass; one failure produces `NO_MATCH`. The count can be adjusted between 2 and 5 with `--live-samples`.

The camera index can also be set with `FACE_CAMERA_INDEX`. The storage location can be changed with `FACE_TEMPLATE_DIR`. Enrollment and live counts can be set with `FACE_ENROLLMENT_SAMPLES` and `FACE_LIVE_SAMPLES`.

## Detector, representation, and matching

- Camera stabilization: for 1.5 seconds after opening the camera, frames are continuously read and discarded. A separate successful frame is then captured. Both stabilization reads and post-stabilization attempts are bounded. Override the duration with `--stabilization-seconds` or `FACE_CAMERA_STABILIZATION_SECONDS`.
- Detector: OpenCV's frontal-face Haar cascade, with a minimum detected size of 80 by 80 pixels. Exactly one detection is required.
- Face normalization: the Haar box is clipped to the frame, then a deterministic centered square covering 90% of its shorter dimension is used. This inscribed square minimizes surrounding context and is resized to 96 by 96 without changing aspect ratio. This iteration deliberately adds no landmark or eye detector.
- Representation: the square grayscale face is histogram-equalized, converted to 59-bin uniform local binary patterns, and divided into an 8 by 8 spatial grid. The algorithm identifier is `spatial-uniform-lbp-square-v2`.
- Enrollment aggregation: each live representation is compared with every enrolled representation using mean per-cell chi-square distance. The median of all enrollment distances is the live-sample score; minimum distance is never used.
- Live consensus: all required live-sample median scores must be at or below the threshold. The reported decision distance is the maximum live-sample score because it is the value governing this all-pass rule. Multiple qualifying employees are rejected as ambiguous.
- Threshold: `DEFAULT_MATCH_DISTANCE_THRESHOLD = 0.35`. Override it with `--threshold` or `FACE_MATCH_THRESHOLD`; accepted values are 0.0 through 1.0.

The threshold remains uncalibrated after the capture and representation changes. Record same-person and different-person distances under the deployed lighting and camera position before changing it.

## Template compatibility

Templates use schema version 2 and contain multiple representation vectors. Schema-version-1 single-sample templates fail with a clear `TEMPLATE_ERROR` requiring re-registration; they are never silently interpreted using the new semantics.

## Safe diagnostics

Add `--debug` to registration or recognition to print non-biometric diagnostics:

```bash
python -m edge.face.cli recognize --camera-index 0 --debug
```

The diagnostics report stabilization duration and elapsed time, discarded frame counts, Haar bounding-box pixels and relative position, normalized square crop geometry, enrollment/live sample progress, per-live-sample median distances, consensus decisions, and aggregate representation statistics. They never print a representation vector and never persist a frame or crop.

## Privacy

Templates default to `edge/face/data/templates/`, which is Git-ignored. Never commit this directory or captured employee images. CLI output includes employee code and distance only; it does not print template vectors.

## Hardware-independent tests

```bash
python -m unittest discover -s edge/face/tests -v
```
