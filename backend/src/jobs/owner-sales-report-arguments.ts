import type { SalesReportDataMode, SalesReportType } from "../reports/sales-report";

export interface OwnerReportJobArguments {
  type: SalesReportType;
  send: boolean;
  dataMode: SalesReportDataMode;
  asOf?: Date;
  demoEnabled: boolean;
  scheduled: boolean;
  configurationWarning?: string;
}

const SCHEDULED_DATA_MODE_VARIABLE = "OWNER_REPORT_SCHEDULED_DATA_MODE";

function scheduledDataMode(
  environment: NodeJS.ProcessEnv,
  demoEnabled: boolean,
): { dataMode: SalesReportDataMode; configurationWarning?: string } {
  const configuredMode = environment[SCHEDULED_DATA_MODE_VARIABLE];

  if (configuredMode === "DEMO_TEST") {
    if (!demoEnabled) {
      throw new Error("Scheduled DEMO_TEST reports require OWNER_REPORT_DEMO_ENABLED=true.");
    }
    return { dataMode: "DEMO_TEST" };
  }

  if (demoEnabled) {
    throw new Error(
      "Scheduled reports with OWNER_REPORT_DEMO_ENABLED=true require " +
        `${SCHEDULED_DATA_MODE_VARIABLE}=DEMO_TEST.`,
    );
  }

  if (configuredMode === "LIVE") return { dataMode: "LIVE" };

  return {
    dataMode: "LIVE",
    configurationWarning: `${SCHEDULED_DATA_MODE_VARIABLE} is missing or invalid; defaulting to LIVE.`,
  };
}

function parseAsOf(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("--as-of must use YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asOf = new Date(Date.UTC(year, month - 1, day, 1));
  if (
    asOf.getUTCFullYear() !== year ||
    asOf.getUTCMonth() !== month - 1 ||
    asOf.getUTCDate() !== day
  ) {
    throw new Error("--as-of must be a valid calendar date.");
  }
  return asOf;
}

export function parseOwnerReportArguments(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): OwnerReportJobArguments {
  const [reportName, ...flags] = arguments_;
  if (reportName !== "daily" && reportName !== "weekly") {
    throw new Error(
      "Usage: owner-sales-report <daily|weekly> [--scheduled|--demo] " +
        "[--as-of=YYYY-MM-DD] [--send]",
    );
  }

  let send = false;
  let demo = false;
  let scheduled = false;
  let asOf: Date | undefined;
  const seen = new Set<string>();
  for (const flag of flags) {
    const name = flag.startsWith("--as-of=") ? "--as-of" : flag;
    if (seen.has(name)) throw new Error(`Duplicate argument: ${name}`);
    seen.add(name);
    if (flag === "--send") send = true;
    else if (flag === "--demo") demo = true;
    else if (flag === "--scheduled") scheduled = true;
    else if (flag.startsWith("--as-of=")) asOf = parseAsOf(flag.slice("--as-of=".length));
    else throw new Error(`Unknown argument: ${flag}`);
  }

  if (demo && scheduled) throw new Error("--demo and --scheduled cannot be combined.");
  if (asOf && !demo) throw new Error("--as-of is permitted only with --demo.");
  const demoEnabled = environment.OWNER_REPORT_DEMO_ENABLED === "true";
  if (demo && !demoEnabled) {
    throw new Error("--demo requires OWNER_REPORT_DEMO_ENABLED=true.");
  }

  const scheduledMode = scheduled ? scheduledDataMode(environment, demoEnabled) : undefined;

  return {
    type: reportName === "daily" ? "DAILY" : "WEEKLY",
    send,
    dataMode: demo ? "DEMO_TEST" : (scheduledMode?.dataMode ?? "LIVE"),
    asOf,
    demoEnabled,
    scheduled,
    configurationWarning: scheduledMode?.configurationWarning,
  };
}
