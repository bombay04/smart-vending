import { useEffect, useState } from "react";
import {
  cancelKioskSession,
  fetchCurrentKioskSession,
  startRestockSession,
  type KioskSession,
} from "../api/kiosk-session";
import { getPortalSessionState } from "../portal-session-state.mjs";

function StaffPortal() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stopped = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try {
        const current = await fetchCurrentKioskSession(controller.signal);
        if (!stopped) {
          setSession(current);
          setSessionLoaded(true);
          setSessionError(null);
        }
      } catch {
        if (!stopped) {
          setSessionLoaded(true);
          setSessionError("ไม่สามารถตรวจสอบสถานะเครื่องได้");
        }
      } finally {
        if (!stopped) timeoutId = window.setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timeoutId = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  async function handleStartRestock() {
    if (sessionBusy || session !== null) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      setSession(await startRestockSession());
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? `ไม่สามารถเริ่มการเติมสินค้าได้: ${error.message}`
          : "ไม่สามารถเริ่มการเติมสินค้าได้",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCancelRestock() {
    if (session?.type !== "RESTOCK_AUTH" || sessionBusy) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      await cancelKioskSession(session.id);
      setSession(null);
      setMessage("ยกเลิกการเติมสินค้าแล้ว");
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? `ไม่สามารถยกเลิกการเติมสินค้าได้: ${error.message}`
          : "ไม่สามารถยกเลิกการเติมสินค้าได้",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  const portalState = getPortalSessionState(session, "RESTOCK_AUTH");
  const secondsRemaining = session
    ? Math.max(
        0,
        Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000),
      )
    : 0;

  return (
    <main className="home-page remote-portal-page staff-portal-page">
      <div className="staff-portal-container">
        <header className="staff-portal-header">
          <div>
            <p className="mode-label mode-label--employee">สำหรับพนักงาน</p>
            <h1>จัดการเติมสินค้า</h1>
          </div>
        </header>

        <section
          className="staff-session-section"
          aria-labelledby="restock-session-title"
        >
          <div className="staff-section-heading">
            <div>
              <h2 id="restock-session-title">สถานะการเติมสินค้า</h2>
              <p>เครื่องจะตรวจสอบพนักงานก่อนเข้าสู่โหมดเติมสินค้า</p>
            </div>
            {portalState === "IDLE" && (
              <button
                className="staff-primary-action"
                type="button"
                disabled={
                  sessionBusy || !sessionLoaded || sessionError !== null
                }
                onClick={() => void handleStartRestock()}
              >
                {sessionBusy ? "กำลังเริ่ม..." : "เริ่มเติมสินค้า"}
              </button>
            )}
          </div>

          {portalState === "KIOSK_BUSY" && (
            <div className="staff-busy-session" role="status">
              <strong>เครื่องกำลังทำงานอื่นอยู่</strong>
              <p>เริ่มเติมสินค้าได้เมื่องานปัจจุบันเสร็จสิ้นหรือหมดเวลา</p>
            </div>
          )}

          {sessionError && (
            <p className="staff-message staff-message--error">{sessionError}</p>
          )}
          {message && (
            <p className="staff-message staff-message--success">{message}</p>
          )}
        </section>
      </div>

      {portalState === "OWN_SESSION" && session !== null && (
        <div className="staff-restock-modal-backdrop">
          <section
            className="staff-restock-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-restock-modal-title"
            aria-describedby="staff-restock-modal-description"
          >
            <div className="staff-restock-modal-icon" aria-hidden="true">
              ◉
            </div>
            <h2 id="staff-restock-modal-title">
              กำลังรอยืนยันตัวตนพนักงาน
            </h2>
            <p id="staff-restock-modal-description">
              กรุณาสแกนใบหน้าที่หน้าจอเครื่องขายสินค้า
            </p>
            <p className="staff-restock-countdown" role="timer" aria-live="off">
              หมดอายุใน {secondsRemaining} วินาที
            </p>
            <button
              className="staff-restock-cancel"
              type="button"
              disabled={sessionBusy}
              onClick={() => void handleCancelRestock()}
            >
              {sessionBusy ? "กำลังยกเลิก..." : "ยกเลิก"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default StaffPortal;
