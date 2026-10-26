import {
  LineOwnerReportProvider,
  type OwnerReportProvider,
} from "../reports/owner-line-report.provider";

export function getMaintenanceAlertProvider(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
): OwnerReportProvider {
  return new LineOwnerReportProvider(
    environment.LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN?.trim() ?? "",
    fetchImplementation,
  );
}
