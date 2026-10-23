import { prisma } from "../lib/prisma";
import { runOwnerReport } from "../reports/owner-report.service";
import { parseOwnerReportArguments } from "./owner-sales-report-arguments";

async function main(): Promise<void> {
  const options = parseOwnerReportArguments(process.argv.slice(2), process.env);
  const result = await runOwnerReport(options.type, options);
  if (result.delivery === "PREVIEW") {
    process.stdout.write(`${JSON.stringify(result.message, null, 2)}\n`);
  }
  process.exitCode = 0;
}

void main()
  .catch((error: unknown) => {
    console.error("Owner sales report job failed.", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
