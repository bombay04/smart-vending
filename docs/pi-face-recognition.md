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

The normal registration and recognition commands require these runtime-only OpenCV Zoo models under `edge/face/data/models/`:

- `face_detection_yunet_2023mar.onnx`
- `face_recognition_sface_2021dec.onnx`

The complete `edge/face/data/` directory is Git-ignored. Application code never downloads models.

## Find a usable camera index

Linux can expose several `/dev/video*` nodes for one physical device. Probe integer indices and require both a successful open and a content-healthy captured frame:

```bash
python -m edge.face.cli probe-camera --start-index 0 --max-index 10
```

Use an index reported as `CAMERA_OK`. `CAMERA_NO_FRAME` means the node opened but did not deliver a usable, non-dead image, and `CAMERA_UNAVAILABLE` means it did not open.

## Register EMP001

Only one usable frontal face may be visible:

```bash
python -m edge.face.cli register --employee-code EMP001 --camera-index 0
```

Registration collects five separately captured usable faces by default and saves five SFace embeddings. Each capture performs camera stabilization again; one frame is never copied five times. It does not save captured frames, detections, landmarks, or aligned crops. The old template is replaced only after every new sample succeeds and the complete schema-v3 template validates.

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
MATCH employeeCode=EMP001 distance=0.923456 threshold=1.128000 liveSamples=3
```

or:

```text
NO_MATCH distance=1.250000 threshold=1.128000 passedSamples=2/3
```

`NO_MATCH` exits with status 1. Operational errors such as `NO_FACE`, `MULTIPLE_FACES`, `CAMERA_ERROR`, and `TEMPLATE_ERROR` exit with status 2 and remain distinguishable from a valid non-match.

Recognition collects three live samples by default. Every live sample must pass; one failure produces `NO_MATCH`. The count can be adjusted between 2 and 5 with `--live-samples`.

The camera index can also be set with `FACE_CAMERA_INDEX`. The storage location can be changed with `FACE_TEMPLATE_DIR`. Enrollment and live counts can be set with `FACE_ENROLLMENT_SAMPLES` and `FACE_LIVE_SAMPLES`. The SFace L2 threshold can be set with `--sface-l2-threshold` or `FACE_SFACE_L2_THRESHOLD`.

## Detector, embedding, and matching

- Camera stabilization and recovery: for 1.5 seconds after opening the camera, frames are continuously read and discarded, subject to a 180-read ceiling. Up to five subsequent frames are inspected. A frame must be a finite numeric, three-channel BGR image at least 32 by 32 pixels. A frame whose maximum channel value is `2` or lower is classified as `BLACK_FRAME`; using the maximum rather than a mean-brightness cutoff deliberately avoids treating an ordinarily dark room with any real sensor detail as a dead stream. Open, read, invalid-frame, and black-frame failures release the capture, wait 250 ms, then reopen, warm up, and revalidate, with at most two recovery attempts (three opens total). Supported OpenCV backends also receive a one-second read-timeout hint. No USB unbind, power reset, or privileged command is used. Override the stabilization duration with `--stabilization-seconds` or `FACE_CAMERA_STABILIZATION_SECONDS`.
- Detector: OpenCV `FaceDetectorYN` with the official YuNet 2023mar model. Its input size is set to the fresh frame's actual dimensions. Exactly one valid 15-value detection row—box, five landmarks, and confidence—is required.
- Face normalization: the complete YuNet detection row is passed to `FaceRecognizerSF.alignCrop()`. There is no Haar box, manual square crop, histogram equalization, or old 96 by 96 resize.
- Embedding: the aligned face is passed to SFace `feature()`. Output must be one floating 128-value feature row with finite values and a non-zero finite norm. The algorithm identifier is `opencv-yunet-2023mar-sface-2021dec`.
- Enrollment aggregation: each live embedding is compared with every enrolled embedding using OpenCV `FaceRecognizerSF` `FR_NORM_L2`. The median of all enrollment distances is the live-sample score; minimum distance is never used.
- Live consensus: all required live-sample median scores must be at or below the threshold. The reported decision distance is the maximum live-sample score because it is the value governing this all-pass rule. Multiple qualifying employees are rejected as ambiguous.
- Threshold: `DEFAULT_SFACE_L2_DISTANCE_THRESHOLD = 1.128`. This is the upstream OpenCV LFW reference, not a calibrated project threshold. Override it with `--sface-l2-threshold` or `FACE_SFACE_L2_THRESHOLD`; values must be finite, greater than 0.0, and less than 2.0.

The threshold remains uncalibrated. Record same-person and different-person distances under the deployed lighting and camera position before accepting or changing it.

## Template compatibility

Templates use schema version 3 and contain model identifiers, the `opencv-fr-norm-l2` metric identifier, and multiple SFace embeddings. Schema-v2 LBP templates fail with a clear `TEMPLATE_ERROR` requiring deliberate re-registration; they are never converted, deleted, or silently interpreted as SFace.

## Safe diagnostics

Add `--debug` to registration or recognition to print non-biometric diagnostics:

```bash
python -m edge.face.cli recognize --camera-index 0 --debug
```

The diagnostics report stabilization, frame dimensions, YuNet box geometry and confidence, landmark validity, inference timings, embedding shape/type/norm, enrollment/live sample progress, per-live-sample median L2 distances, and consensus decisions. They never print an embedding and never persist a frame, detection, aligned crop, or landmark data.

## Privacy

Templates default to `edge/face/data/templates/`, which is Git-ignored. Never commit this directory, the runtime models, or captured employee images. CLI output includes employee code and aggregate distance only; it does not print template embeddings.

## Hardware-independent tests

```bash
python -m unittest discover -s edge/face/tests -v
```
