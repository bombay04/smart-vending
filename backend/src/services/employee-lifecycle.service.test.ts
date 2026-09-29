import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  draftDeleteIneligibility,
  parseDraftDeleteResult,
  requireEmptyLifecycleBody,
  type DraftDeleteCandidate,
} from "./employee-lifecycle.service";

const NOW = new Date("2026-09-29T07:00:00.000Z");

function candidate(overrides: Partial<DraftDeleteCandidate> = {}): DraftDeleteCandidate {
  return {
    id: 4,
    employeeCode: "EMP004",
    name: "Draft Employee",
    isActive: true,
    faceRegistered: false,
    restockLogCount: 0,
    sessions: [],
    ...overrides,
  };
}

function session(
  type: DraftDeleteCandidate["sessions"][number]["type"],
  status: DraftDeleteCandidate["sessions"][number]["status"],
  id = 10,
) {
  return { id, type, status, expiresAt: new Date(NOW.getTime() + 60_000) };
}

test("pristine unused employee can start Pi-verified draft deletion", () => {
  assert.equal(draftDeleteIneligibility(candidate(), NOW), null);
});

test("restock and completed registration history permanently block draft deletion", () => {
  assert.match(draftDeleteIneligibility(candidate({ restockLogCount: 1 }), NOW)!, /unused draft/i);
  assert.match(
    draftDeleteIneligibility(
      candidate({ sessions: [session("FACE_REGISTRATION", "COMPLETED")] }),
      NOW,
    )!,
    /unused draft/i,
  );
});

test("cancelled and expired registration attempts remain disposable", () => {
  assert.equal(
    draftDeleteIneligibility(
      candidate({
        sessions: [
          session("FACE_REGISTRATION", "CANCELLED", 1),
          session("FACE_REGISTRATION", "EXPIRED", 2),
        ],
      }),
      NOW,
    ),
    null,
  );
});

test("active conflicting work is rejected but the bound verification session is allowed", () => {
  const activeRegistration = candidate({
    sessions: [session("FACE_REGISTRATION", "ACTIVE", 7)],
  });
  assert.match(draftDeleteIneligibility(activeRegistration, NOW)!, /active conflicting/i);

  const activeVerification = candidate({
    sessions: [session("EMPLOYEE_DRAFT_DELETE", "ACTIVE", 8)],
  });
  assert.match(draftDeleteIneligibility(activeVerification, NOW)!, /active conflicting/i);
  assert.equal(draftDeleteIneligibility(activeVerification, NOW, 8), null);
});

test("registered employees and offboarding history are never treated as drafts", () => {
  assert.notEqual(draftDeleteIneligibility(candidate({ faceRegistered: true }), NOW), null);
  assert.notEqual(
    draftDeleteIneligibility(
      candidate({ sessions: [session("EMPLOYEE_OFFBOARDING", "COMPLETED")] }),
      NOW,
    ),
    null,
  );
});

test("cleanup request parsers accept only narrow metadata bodies", () => {
  assert.equal(parseDraftDeleteResult({ templateExists: false }), false);
  assert.equal(parseDraftDeleteResult({ templateExists: true }), true);
  requireEmptyLifecycleBody({});
  for (const body of [
    {},
    { templateExists: "false" },
    { templateExists: false, employeeCode: "EMP004" },
  ]) {
    assert.throws(
      () => parseDraftDeleteResult(body),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
  assert.throws(
    () => requireEmptyLifecycleBody({ employeeId: 4 }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("lifecycle persistence keeps history, reconciles template presence, and deletes only disposable rows", async () => {
  const source = await readFile(resolve("src/services/employee-lifecycle.service.ts"), "utf8");
  assert.match(source, /data: \{ isActive: false \}/);
  assert.match(source, /data: \{ isActive: false, faceRegistered: false \}/);
  assert.match(source, /data: \{ isActive: false, faceRegistered: true \}/);
  assert.match(source, /type: "FACE_REGISTRATION", status: \{ in: \["CANCELLED", "EXPIRED"\] \}/);
  assert.match(source, /transaction\.kioskSession\.deleteMany[\s\S]*transaction\.employee\.delete/);
  assert.doesNotMatch(source, /restockLog\.delete/);
  assert.match(source, /isolationLevel: "Serializable"/);
});
