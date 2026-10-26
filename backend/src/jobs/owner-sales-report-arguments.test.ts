import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerReportArguments } from "./owner-sales-report-arguments";

test("LIVE is the default and preview does not imply send", () => {
  const parsed = parseOwnerReportArguments(["daily"], {});
  assert.equal(parsed.type, "DAILY");
  assert.equal(parsed.dataMode, "LIVE");
  assert.equal(parsed.send, false);
  assert.equal(parsed.scheduled, false);
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

test("scheduled mode uses explicit configuration and visibly defaults to LIVE", () => {
  const missing = parseOwnerReportArguments(["daily", "--scheduled", "--send"], {});
  assert.equal(missing.dataMode, "LIVE");
  assert.equal(missing.scheduled, true);
  assert.match(missing.configurationWarning ?? "", /defaulting to LIVE/);

  const invalid = parseOwnerReportArguments(["weekly", "--scheduled"], {
    OWNER_REPORT_SCHEDULED_DATA_MODE: "demo_test",
  });
  assert.equal(invalid.dataMode, "LIVE");
  assert.match(invalid.configurationWarning ?? "", /defaulting to LIVE/);

  const live = parseOwnerReportArguments(["daily", "--scheduled"], {
    OWNER_REPORT_SCHEDULED_DATA_MODE: "LIVE",
  });
  assert.equal(live.dataMode, "LIVE");
  assert.equal(live.configurationWarning, undefined);
});

test("scheduled DEMO_TEST requires an exact mode and the independent demo gate", () => {
  assert.throws(
    () =>
      parseOwnerReportArguments(["daily", "--scheduled", "--send"], {
        OWNER_REPORT_SCHEDULED_DATA_MODE: "DEMO_TEST",
      }),
    /OWNER_REPORT_DEMO_ENABLED=true/,
  );

  const demo = parseOwnerReportArguments(["weekly", "--scheduled", "--send"], {
    OWNER_REPORT_SCHEDULED_DATA_MODE: "DEMO_TEST",
    OWNER_REPORT_DEMO_ENABLED: "true",
  });
  assert.equal(demo.dataMode, "DEMO_TEST");
  assert.equal(demo.demoEnabled, true);
  assert.equal(demo.scheduled, true);
  assert.equal(demo.asOf, undefined);

  assert.throws(
    () =>
      parseOwnerReportArguments(["daily", "--scheduled"], {
        OWNER_REPORT_DEMO_ENABLED: "true",
      }),
    /OWNER_REPORT_SCHEDULED_DATA_MODE=DEMO_TEST/,
  );
  assert.throws(
    () =>
      parseOwnerReportArguments(["daily", "--scheduled", "--demo"], {
        OWNER_REPORT_SCHEDULED_DATA_MODE: "DEMO_TEST",
        OWNER_REPORT_DEMO_ENABLED: "true",
      }),
    /cannot be combined/,
  );
  assert.throws(() =>
    parseOwnerReportArguments(["daily", "--scheduled", "--as-of=2026-10-23"], {
      OWNER_REPORT_SCHEDULED_DATA_MODE: "LIVE",
    }),
  );
});

test("scheduled configuration does not change existing manual LIVE and DEMO commands", () => {
  const manualLive = parseOwnerReportArguments(["daily", "--send"], {
    OWNER_REPORT_SCHEDULED_DATA_MODE: "DEMO_TEST",
    OWNER_REPORT_DEMO_ENABLED: "true",
  });
  assert.equal(manualLive.dataMode, "LIVE");
  assert.equal(manualLive.scheduled, false);

  const manualDemo = parseOwnerReportArguments(["daily", "--demo", "--send"], {
    OWNER_REPORT_SCHEDULED_DATA_MODE: "LIVE",
    OWNER_REPORT_DEMO_ENABLED: "true",
  });
  assert.equal(manualDemo.dataMode, "DEMO_TEST");
  assert.equal(manualDemo.scheduled, false);
});
