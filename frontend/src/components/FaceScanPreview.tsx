import { useEffect, useState } from "react";
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
  TURN_LEFT: "หันใบหน้าตามลูกศร ←",
  TURN_RIGHT: "หันใบหน้าตามลูกศร →",
  RETURN_CENTER: "หันกลับมามองตรง",
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
  });
  const [revision, setRevision] = useState(0);
  const [imageVisible, setImageVisible] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const poll = async () => {
      try {
        const next = await fetchFaceScanStatus(scanId, controller.signal);
        if (next !== null && !stopped) {
          setStatus(next);
          onStatus?.(next);
        }
      } catch {
        // The operation response owns the terminal error state.
      }
    };
    const statusTimer = window.setInterval(() => void poll(), 250);
    const previewTimer = window.setInterval(() => setRevision((value) => value + 1), 220);
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(statusTimer);
      window.clearInterval(previewTimer);
    };
  }, [onStatus, scanId]);

  return (
    <div className="face-preview" aria-label="ภาพสดจากกล้องสแกนใบหน้า">
      {status.previewReady && (
        <img
          className={`face-preview__image${imageVisible ? " face-preview__image--visible" : ""}`}
          src={faceScanPreviewUrl(scanId, revision)}
          alt="ภาพสดสำหรับจัดตำแหน่งใบหน้า"
          onLoad={() => setImageVisible(true)}
          onError={() => setImageVisible(false)}
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
