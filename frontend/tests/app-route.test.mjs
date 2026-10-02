import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_PORTAL_PATH,
  CUSTOMER_KIOSK_PATH,
  resolveAppPathname,
  STAFF_PORTAL_PATH,
} from "../src/app-route.mjs";

test("customer, staff, and admin routes remain distinct", () => {
  assert.equal(resolveAppPathname(CUSTOMER_KIOSK_PATH), "/");
  assert.equal(resolveAppPathname(STAFF_PORTAL_PATH), "/staff");
  assert.equal(resolveAppPathname(ADMIN_PORTAL_PATH), "/admin");
  assert.equal(resolveAppPathname("/unknown"), "/");
});

test("remote portal routes render their portals without customer navigation", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /pathname === STAFF_PORTAL_PATH[\s\S]*<StaffPortal \/>/);
  assert.match(app, /pathname === ADMIN_PORTAL_PATH[\s\S]*<AdminPortal \/>/);
  assert.doesNotMatch(app, /returnToCustomerKiosk|onBack=/);
});
