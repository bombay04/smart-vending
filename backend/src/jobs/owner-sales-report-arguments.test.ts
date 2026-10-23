import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerReportArguments } from "./owner-sales-report-arguments";

test("LIVE is the default and preview does not imply send", () => {
  const parsed = parseOwnerReportArguments(["daily"], {});
  assert.equal(parsed.type, "DAILY");
  assert.equal(parsed.dataMode, "LIVE");
  assert.equal(parsed.send, false);
});

test("DEMO requires the explicit flag and exact environment gate", () => {
  assert.throws(
    () => parseOwnerReportArguments(["daily", "--demo"], {}),
    /OWNER_REPORT_DEMO_ENABLED=true/,
  );
  assert.throws(
    () =>
      parseOwnerReportArguments(["daily", "--demo"], {
        OWNER_REPORT_DEMO_ENABLED: "TRUE",
      }),
    /OWNER_REPORT_DEMO_ENABLED=true/,
  );
  const preview = parseOwnerReportArguments(["weekly", "--demo"], {
    OWNER_REPORT_DEMO_ENABLED: "true",
  });
  assert.equal(preview.dataMode, "DEMO_TEST");
  assert.equal(preview.send, false);
});

test("DEMO send requires --send and supports a strict as-of date", () => {
  const parsed = parseOwnerReportArguments(["daily", "--demo", "--as-of=2026-10-23", "--send"], {
    OWNER_REPORT_DEMO_ENABLED: "true",
  });
  assert.equal(parsed.send, true);
  assert.equal(parsed.asOf?.toISOString(), "2026-10-23T01:00:00.000Z");
  assert.throws(() => parseOwnerReportArguments(["daily", "--as-of=2026-10-23"], {}));
  assert.throws(() =>
    parseOwnerReportArguments(["daily", "--demo", "--as-of=2026-02-30"], {
      OWNER_REPORT_DEMO_ENABLED: "true",
    }),
  );
  assert.throws(() =>
    parseOwnerReportArguments(["daily", "--demo", "--send", "--send"], {
      OWNER_REPORT_DEMO_ENABLED: "true",
    }),
  );
});
