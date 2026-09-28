import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideKioskSessionAction } from "../src/kiosk-session-flow.mjs";

const restock = { id: 10, type: "RESTOCK_AUTH", employee: null };
const registration = {
  id: 11,
  type: "FACE_REGISTRATION",
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
test("cancelled or expired sessions exit an unfinished staff flow", () => {
  assert.equal(action({ currentMode: "employee-auth" }), "EXIT_STAFF");
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

test("staff portal keeps employee creation separate and exposes responsive remote actions", async () => {
  const [portal, css] = await Promise.all([
    readFile(
      new URL("../src/components/StaffPortal.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /Start Restock/);
  assert.match(portal, /Start Face Registration/);
  assert.match(portal, /createEmployee\(name\)/);
  assert.match(portal, /does not start\s+face\s+registration/);
  assert.match(portal, /cancelKioskSession/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.staff-active-session[\s\S]*flex-direction: column/);
});
