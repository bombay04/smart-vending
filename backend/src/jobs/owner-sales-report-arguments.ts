import type { SalesReportDataMode, SalesReportType } from "../reports/sales-report";

export interface OwnerReportJobArguments {
  type: SalesReportType;
  send: boolean;
  dataMode: SalesReportDataMode;
  asOf?: Date;
  demoEnabled: boolean;
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
      "Usage: owner-sales-report <daily|weekly> [--demo] [--as-of=YYYY-MM-DD] [--send]",
    );
  }

  let send = false;
  let demo = false;
  let asOf: Date | undefined;
  const seen = new Set<string>();
  for (const flag of flags) {
    const name = flag.startsWith("--as-of=") ? "--as-of" : flag;
    if (seen.has(name)) throw new Error(`Duplicate argument: ${name}`);
    seen.add(name);
    if (flag === "--send") send = true;
    else if (flag === "--demo") demo = true;
    else if (flag.startsWith("--as-of=")) asOf = parseAsOf(flag.slice("--as-of=".length));
    else throw new Error(`Unknown argument: ${flag}`);
  }

  if (asOf && !demo) throw new Error("--as-of is permitted only with --demo.");
  const demoEnabled = environment.OWNER_REPORT_DEMO_ENABLED === "true";
  if (demo && !demoEnabled) {
    throw new Error("--demo requires OWNER_REPORT_DEMO_ENABLED=true.");
  }

  return {
    type: reportName === "daily" ? "DAILY" : "WEEKLY",
    send,
    dataMode: demo ? "DEMO_TEST" : "LIVE",
    asOf,
    demoEnabled,
  };
}
