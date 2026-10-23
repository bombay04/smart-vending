import { useEffect, useRef, useState } from "react";
import {
  faceScanPreviewUrl,
  fetchFaceScanStatus,
  type FaceScanState,
  type FaceScanStatus,
} from "../api/face-scan";

const GUIDANCE: Record<FaceScanState, string> = {
  CAMERA_STARTING: "กำลังเปิดกล้อง...",
  POSITION_FACE: "จัดใบหน้าให้อยู่ในกรอบ",
  FACE_DETECTED: "ตรวจพบใบหน้า กรุณามองตรง",
  NO_FACE: "ไม่พบใบหน้า กรุณาขยับเข้าหากล้อง",
  MULTIPLE_FACES: "กรุณาให้มีเพียงหนึ่งคนในภาพ",
  // Deployed YuNet/camera coordinates are mirrored: the legacy server token
  // TURN_RIGHT is the employee's physical left, and TURN_LEFT is physical right.
  TURN_LEFT: "หันหน้าไปทางขวา",
  TURN_RIGHT: "หันหน้าไปทางซ้าย",
  RETURN_CENTER: "กลับมามองตรง",
  VERIFYING: "กำลังตรวจสอบและบันทึกภาพ...",
  SUCCESS: "ตรวจสอบสำเร็จ",
  ERROR: "ไม่สามารถตรวจสอบได้",
  CANCELLED: "ยกเลิกการสแกนแล้ว",
};

interface FaceScanPreviewProps {
  scanId: string;
  onStatus?: (status: FaceScanStatus) => void;
}

function FaceScanPreview({ scanId, onStatus }: FaceScanPreviewProps) {
  const [status, setStatus] = useState<FaceScanStatus>({
    state: "CAMERA_STARTING",
    challenge: null,
    progress: 0,
    required: 0,
    previewReady: false,
    previewVersion: 0,
  });
  const [requestedPreviewVersion, setRequestedPreviewVersion] = useState(0);
  const [imageVisible, setImageVisible] = useState(false);
  const requestedPreviewVersionRef = useRef(0);
  const imageRequestPendingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let statusTimer: number | null = null;
    const poll = async () => {
      try {
        const next = await fetchFaceScanStatus(scanId, controller.signal);
        if (next !== null && !stopped) {
          setStatus((current) =>
            current.state === next.state &&
            current.challenge === next.challenge &&
            current.progress === next.progress &&
            current.required === next.required &&
            current.previewReady === next.previewReady &&
            current.previewVersion === next.previewVersion
              ? current
              : next,
          );
          if (
            !imageRequestPendingRef.current &&
            next.previewReady &&
            next.previewVersion > requestedPreviewVersionRef.current
          ) {
            imageRequestPendingRef.current = true;
            requestedPreviewVersionRef.current = next.previewVersion;
            setRequestedPreviewVersion(next.previewVersion);
          }
          onStatus?.(next);
        }
      } catch {
        // The operation response owns the terminal error state.
      } finally {
        if (!stopped) {
          statusTimer = window.setTimeout(() => void poll(), 150);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (statusTimer !== null) window.clearTimeout(statusTimer);
    };
  }, [onStatus, scanId]);

  return (
    <div className="face-preview" aria-label="ภาพสดจากกล้องสแกนใบหน้า">
      {requestedPreviewVersion > 0 && (
        <img
          className={`face-preview__image${imageVisible ? " face-preview__image--visible" : ""}`}
          src={faceScanPreviewUrl(scanId, requestedPreviewVersion)}
          alt="ภาพสดสำหรับจัดตำแหน่งใบหน้า"
          onLoad={() => {
            setImageVisible(true);
            imageRequestPendingRef.current = false;
          }}
          onError={() => {
            setImageVisible(false);
            imageRequestPendingRef.current = false;
          }}
        />
      )}
      <div className="face-preview__guide" aria-hidden="true" />
      <div className="face-preview__status" role="status" aria-live="polite">
        {GUIDANCE[status.state]}
        {status.required > 0 && status.progress > 0 && (
          <span>{` ${Math.min(status.progress, status.required)}/${status.required}`}</span>
        )}
      </div>
    </div>
  );
}

export default FaceScanPreview;
