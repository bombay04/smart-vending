import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideKioskSessionAction } from "../src/kiosk-session-flow.mjs";
import { getPortalSessionState } from "../src/portal-session-state.mjs";
import { cancelRestockSessionAndCleanup } from "../src/restock-session-cleanup.mjs";

const restock = { id: 10, type: "RESTOCK_AUTH", employee: null };
const registration = {
  id: 11,
  type: "FACE_REGISTRATION",
  employee: { id: 7, employeeCode: "EMP007", name: "Bound Employee" },
};
const draftDelete = {
  id: 12,
  type: "EMPLOYEE_DRAFT_DELETE",
  employee: { id: 7, employeeCode: "EMP007", name: "Bound Employee" },
};
const offboarding = {
  id: 13,
  type: "EMPLOYEE_OFFBOARDING",
  employee: { id: 7, employeeCode: "EMP007", name: "Bound Employee" },
};
const action = (overrides = {}) =>
  decideKioskSessionAction({
    session: null,
    isSafeIdle: true,
    currentMode: "customer",
    acceptedSessionIds: new Set(),
    workflowCompleted: false,
    ...overrides,
  });

test("no active session stays in customer mode", () =>
  assert.equal(action(), "STAY"));
test("RESTOCK_AUTH enters face authentication only while safely idle", () => {
  assert.equal(action({ session: restock }), "START_RESTOCK_AUTH");
  assert.equal(action({ session: restock, isSafeIdle: false }), "STAY");
});
test("FACE_REGISTRATION uses only its backend-bound employee", () => {
  assert.equal(action({ session: registration }), "START_FACE_REGISTRATION");
  assert.equal(
    action({ session: { ...registration, employee: null } }),
    "STAY",
  );
});
test("duplicate polls do not restart an accepted workflow", () => {
  assert.equal(
    action({ session: restock, acceptedSessionIds: new Set([10]) }),
    "STAY",
  );
});
test("an active payment prevents a remote session from hijacking the customer", () => {
  assert.equal(action({ session: registration, isSafeIdle: false }), "STAY");
});
test("employee cleanup is background-only and waits for safe customer idle", () => {
  assert.equal(action({ session: draftDelete }), "PROCESS_DRAFT_DELETE");
  assert.equal(action({ session: offboarding }), "PROCESS_OFFBOARDING");
  assert.equal(action({ session: draftDelete, isSafeIdle: false }), "STAY");
  assert.equal(
    action({ session: offboarding, currentMode: "employee-auth" }),
    "STAY",
  );
});
test("cancelled or expired sessions exit an unfinished staff flow", () => {
  assert.equal(action({ currentMode: "employee-auth" }), "EXIT_STAFF");
});

test("Pi restock exits cancel backend state before clearing local state", async () => {
  let backendSession = restock;
  let localState = { mode: "restock", employeeId: 7, sessionId: restock.id };
  const events = [];

  await cancelRestockSessionAndCleanup({
    sessionId: restock.id,
    async cancelSession(sessionId) {
      assert.equal(sessionId, restock.id);
      events.push("backend-cancelled");
      backendSession = null;
    },
    clearLocalState() {
      events.push("local-cleared");
      localState = { mode: "customer", employeeId: null, sessionId: null };
    },
  });

  assert.deepEqual(events, ["backend-cancelled", "local-cleared"]);
  assert.equal(backendSession, null);
  assert.deepEqual(localState, {
    mode: "customer",
    employeeId: null,
    sessionId: null,
  });
  assert.equal(getPortalSessionState(backendSession, "RESTOCK_AUTH"), "IDLE");
});

test("failed backend cleanup retains the local restock flow for retry", async () => {
  let localClearCount = 0;
  await assert.rejects(
    cancelRestockSessionAndCleanup({
      sessionId: restock.id,
      async cancelSession() {
        throw new Error("offline");
      },
      clearLocalState() {
        localClearCount += 1;
      },
    }),
    /offline/,
  );
  assert.equal(localClearCount, 0);
});

test("customer and direct-route source expose no local staff entry bypass", async () => {
  const [home, app, registrationSource] = await Promise.all([
    readFile(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/components/EmployeeFaceRegistration.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(home, /Employee Mode<\/button>/);
  assert.doesNotMatch(app, /ADMIN_FACE_REGISTRATION_PATH/);
  assert.doesNotMatch(
    registrationSource,
    /Select an employee|Choose Another Employee/,
  );
  assert.match(registrationSource, /authorizedSession\?\.id !== session\.id/);
});

test("portal session state preserves each role boundary during conflicts", () => {
  assert.equal(getPortalSessionState(null, "RESTOCK_AUTH"), "IDLE");
  assert.equal(getPortalSessionState(restock, "RESTOCK_AUTH"), "OWN_SESSION");
  assert.equal(
    getPortalSessionState(registration, "FACE_REGISTRATION"),
    "OWN_SESSION",
  );
  assert.equal(
    getPortalSessionState(registration, "RESTOCK_AUTH"),
    "KIOSK_BUSY",
  );
  assert.equal(
    getPortalSessionState(restock, "FACE_REGISTRATION"),
    "KIOSK_BUSY",
  );
});

test("portals expose only role-owned cancellation and responsive busy states", async () => {
  const [staffPortal, adminPortal, css] = await Promise.all([
    readFile(
      new URL("../src/components/StaffPortal.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/AdminPortal.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  ]);
  assert.match(staffPortal, /session\?\.type !== "RESTOCK_AUTH"/);
  assert.match(staffPortal, /await cancelKioskSession\(session\.id\)/);
  assert.match(adminPortal, /session\?\.type !== "FACE_REGISTRATION"/);
  assert.match(staffPortal, /portalState === "KIOSK_BUSY"/);
  assert.match(adminPortal, /portalState === "KIOSK_BUSY"/);
  assert.match(staffPortal, /Another kiosk workflow is active/);
  assert.match(adminPortal, /Another kiosk workflow is active/);
  assert.doesNotMatch(staffPortal, /Back to Home/);
  assert.doesNotMatch(adminPortal, /Back to Home/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.staff-active-session[\s\S]*flex-direction: column/);
  assert.match(css, /\.staff-employee-row[\s\S]*grid-template-columns/);
});

test("local restock and registration screens retain session guards", async () => {
  const [home, authentication, restockMode, registrationSource] =
    await Promise.all([
      readFile(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../src/components/EmployeeAuthentication.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/components/RestockMode.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/components/EmployeeFaceRegistration.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(home, /activeStaffSession\?\.type === "RESTOCK_AUTH"/);
  assert.match(home, /activeStaffSession\?\.type === "FACE_REGISTRATION"/);
  assert.match(
    authentication,
    /validateFaceAuthenticatedEmployee\([\s\S]*sessionId/,
  );
  assert.match(restockMode, /createMockRestock\(sessionId, employeeId\)/);
  assert.match(home, /cancelRestockSessionAndCleanup/);
  assert.match(home, /cancelSession: cancelKioskSession/);
  assert.match(home, /onExit=\{cancelActiveRestockSession\}/);
  assert.match(home, /onCompletedExit=\{clearStaffWorkflowState\}/);
  assert.match(restockMode, /window\.setTimeout\(\s*onCompletedExit/);
  assert.match(registrationSource, /authorizedSession\?\.id !== session\.id/);
  assert.match(home, /PROCESS_DRAFT_DELETE/);
  assert.match(home, /PROCESS_OFFBOARDING/);
  assert.match(home, /fetchFaceRegistrationStatuses/);
  assert.match(home, /removeEmployeeFaceTemplate/);
  assert.match(home, /reportDraftDeleteResult/);
  assert.match(home, /completeEmployeeOffboarding/);
});
