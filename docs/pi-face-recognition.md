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

Registration saves only the generated representation. It does not save the captured frame or face crop. Re-registering the same employee code replaces that local prototype template.

## Recognize

```bash
python -m edge.face.cli recognize --camera-index 0
```

Success output is either:

```text
MATCH employeeCode=EMP001 distance=0.123456 threshold=0.350000
```

or:

```text
NO_MATCH distance=0.500000 threshold=0.350000
```

`NO_MATCH` exits with status 1. Operational errors such as `NO_FACE`, `MULTIPLE_FACES`, `CAMERA_ERROR`, and `TEMPLATE_ERROR` exit with status 2 and remain distinguishable from a valid non-match.

The camera index can also be set with `FACE_CAMERA_INDEX`. The storage location can be changed with `FACE_TEMPLATE_DIR`.

## Detector, representation, and matching

- Detector: OpenCV's frontal-face Haar cascade, with a minimum detected size of 80 by 80 pixels. Exactly one detection is required.
- Representation: the grayscale face crop is resized to 96 by 96, histogram-equalized, converted to 59-bin uniform local binary patterns, and divided into an 8 by 8 spatial grid.
- Matching: mean per-cell chi-square histogram distance; lower values are more similar.
- Threshold: `DEFAULT_MATCH_DISTANCE_THRESHOLD = 0.35`. Override it with `--threshold` or `FACE_MATCH_THRESHOLD`; accepted values are 0.0 through 1.0.

The threshold is a prototype starting point, not a biometric security claim. Record same-person and different-person distances under the deployed lighting and camera position before changing it.

## Privacy

Templates default to `edge/face/data/templates/`, which is Git-ignored. Never commit this directory or captured employee images. CLI output includes employee code and distance only; it does not print template vectors.

## Hardware-independent tests

```bash
python -m unittest discover -s edge/face/tests -v
```
