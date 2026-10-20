import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STAFF_SESSION_POLL_FAILURE_THRESHOLD,
  createStaffSessionPollState,
  reduceStaffSessionPollState,
} from "../src/staff-session-poll-state.mjs";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff portal renders the Thai primary interface", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(staffPortal, /จัดการเติมสินค้า/);
  assert.doesNotMatch(
    staffPortal,
    /เริ่มและติดตามการเติมสินค้าที่เครื่องขายสินค้า/,
  );
  assert.match(staffPortal, /สถานะการเติมสินค้า/);
  assert.match(staffPortal, /เครื่องจะตรวจสอบพนักงานก่อนเข้าสู่โหมดเติมสินค้า/);
  assert.match(staffPortal, /เริ่มเติมสินค้า/);
  assert.doesNotMatch(staffPortal, /Back to Home/);
});

test("active restock authentication is represented by an accessible modal", async () => {
  const [staffPortal, css] = await Promise.all([
    source("src/components/StaffPortal.tsx"),
    source("src/App.css"),
  ]);

  assert.match(
    staffPortal,
    /portalState === "OWN_SESSION" && session !== null && \(/,
  );
  assert.match(staffPortal, /className="staff-restock-modal-backdrop"/);
  assert.match(staffPortal, /role="dialog"/);
  assert.match(staffPortal, /aria-modal="true"/);
  assert.match(staffPortal, /กำลังรอยืนยันตัวตนพนักงาน/);
  assert.match(staffPortal, /กรุณาสแกนใบหน้าที่หน้าจอเครื่องขายสินค้า/);
  assert.match(staffPortal, /หมดอายุใน \{secondsRemaining\} วินาที/);
  assert.match(staffPortal, /"กำลังยกเลิก\.\.\." : "ยกเลิก"/);
  assert.match(css, /\.staff-restock-modal-backdrop[\s\S]*position: fixed/);
  assert.match(css, /\.staff-restock-modal[\s\S]*width: min\(100%, 560px\)/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
});

test("modal uses authoritative session state and keeps cancel wiring intact", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(
    staffPortal,
    /const portalState = getPortalSessionState\(session/,
  );
  assert.match(staffPortal, /type: "POLL_SUCCEEDED"/);
  assert.match(staffPortal, /await cancelKioskSession\(session\.id\)/);
  assert.match(staffPortal, /type: "SESSION_CANCELLED"/);
  assert.match(staffPortal, /onClick=\{\(\) => void handleCancelRestock\(\)\}/);
  assert.doesNotMatch(staffPortal, /Restock authentication ACTIVE/);
  assert.doesNotMatch(
    staffPortal,
    /The kiosk is waiting for employee face authentication\./,
  );
});

const restockSession = {
  id: 71,
  type: "RESTOCK_AUTH",
};

test("one failed staff poll preserves the known session and recovers silently", () => {
  let state = reduceStaffSessionPollState(createStaffSessionPollState(), {
    type: "POLL_SUCCEEDED",
    session: restockSession,
  });

  state = reduceStaffSessionPollState(state, { type: "POLL_FAILED" });
  assert.equal(state.session, restockSession);
  assert.equal(state.pollingError, null);
  assert.equal(state.statusAvailable, false);

  state = reduceStaffSessionPollState(state, {
    type: "POLL_SUCCEEDED",
    session: restockSession,
  });
  assert.equal(state.session, restockSession);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.pollingError, null);
  assert.equal(state.statusAvailable, true);
});

test("multiple consecutive staff poll failures display a concise connection error", () => {
  let state = reduceStaffSessionPollState(createStaffSessionPollState(), {
    type: "POLL_SUCCEEDED",
    session: restockSession,
  });

  for (
    let failure = 1;
    failure <= STAFF_SESSION_POLL_FAILURE_THRESHOLD;
    failure += 1
  ) {
    state = reduceStaffSessionPollState(state, { type: "POLL_FAILED" });
    if (failure < STAFF_SESSION_POLL_FAILURE_THRESHOLD) {
      assert.equal(state.pollingError, null);
    }
  }

  assert.equal(state.session, restockSession);
  assert.equal(
    state.pollingError,
    "ไม่สามารถตรวจสอบสถานะเครื่องได้ กรุณาตรวจสอบการเชื่อมต่อ",
  );
});

test("a successful staff poll clears an already displayed polling error", () => {
  let state = createStaffSessionPollState();
  for (
    let failure = 0;
    failure < STAFF_SESSION_POLL_FAILURE_THRESHOLD;
    failure += 1
  ) {
    state = reduceStaffSessionPollState(state, { type: "POLL_FAILED" });
  }
  assert.notEqual(state.pollingError, null);

  state = reduceStaffSessionPollState(state, {
    type: "POLL_SUCCEEDED",
    session: null,
  });
  assert.equal(state.pollingError, null);
  assert.equal(state.sessionLoaded, true);
  assert.equal(state.statusAvailable, true);
});

test("staff session start and cancellation remain authoritative transitions", () => {
  let state = reduceStaffSessionPollState(createStaffSessionPollState(), {
    type: "SESSION_STARTED",
    session: restockSession,
  });
  assert.equal(state.session, restockSession);
  assert.equal(state.sessionLoaded, true);

  state = reduceStaffSessionPollState(state, { type: "SESSION_CANCELLED" });
  assert.equal(state.session, null);
  assert.equal(state.sessionLoaded, true);
  assert.equal(state.pollingError, null);
});

test("staff polling uses one chained timer and ignores stale action races", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.equal(
    staffPortal.match(/window\.setTimeout\(poll, 1500\)/g)?.length,
    1,
  );
  assert.doesNotMatch(staffPortal, /window\.setInterval\(poll/);
  assert.match(
    staffPortal,
    /requestMutationVersion === sessionMutationVersionRef\.current/,
  );
  assert.match(
    staffPortal,
    /await startRestockSession\(\);\s*sessionMutationVersionRef\.current \+= 1;\s*setPollState/,
  );
  assert.match(
    staffPortal,
    /await cancelKioskSession\(session\.id\);\s*sessionMutationVersionRef\.current \+= 1;\s*setPollState/,
  );
  assert.match(staffPortal, /controller\?\.abort\(\)/);
  assert.match(staffPortal, /window\.clearTimeout\(timeoutId\)/);
});

test("RESTOCK_AUTH response contract accepts unbound and face-bound employees", async () => {
  const kioskSession = await source("src/api/kiosk-session.ts");

  assert.match(
    kioskSession,
    /session\.type === "RESTOCK_AUTH"\s*\? \(session\.employeeId === null && employee === null\) \|\|\s*hasMatchingEmployee/,
  );
});

test("staff feedback expires and is cleared before a new restock session", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(
    staffPortal,
    /if \(message === null\) return;[\s\S]*window\.setTimeout\(\(\) => setMessage\(null\), 2500\)/,
  );
  assert.match(
    staffPortal,
    /async function handleStartRestock\(\)[\s\S]*setMessage\(null\);[\s\S]*startRestockSession\(\)/,
  );
  assert.match(staffPortal, /ยกเลิกการเติมสินค้าแล้ว/);
});

test("Thai typography is local and mobile modal content remains accessible", async () => {
  const css = await source("src/App.css");

  assert.match(
    css,
    /\.staff-portal-page[\s\S]*"Leelawadee UI", Tahoma, "Noto Sans Thai", sans-serif/,
  );
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.staff-restock-modal[\s\S]*max-height: calc\(100dvh - 32px\)/,
  );
  assert.match(css, /\.staff-restock-cancel[\s\S]*width: 100%/);
});
