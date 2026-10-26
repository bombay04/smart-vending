export interface HardwareAlertMessageInput {
  machineId: string;
  severity: "CRITICAL" | "RECOVERED";
  affectedHardware: string;
  description: string;
  detectedAt: Date;
  recommendedAction: string;
}

export interface HardwareAlertFlexMessage {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

const COLORS = {
  CRITICAL: "#B91C1C",
  RECOVERED: "#15803D",
} as const;

const THAI_TITLES = {
  CRITICAL: "ระบบขัดข้องระดับวิกฤต",
  RECOVERED: "ระบบกลับมาทำงานปกติ",
} as const;

function text(value: string, options: Record<string, unknown> = {}) {
  return { type: "text", text: value, ...options };
}

export function bangkokDateTime(value: Date): string {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(value);
}

export function createHardwareAlertFlex(
  input: HardwareAlertMessageInput,
): HardwareAlertFlexMessage {
  const title = THAI_TITLES[input.severity];
  const color = COLORS[input.severity];
  return {
    type: "flex",
    altText: `${title} — ${input.machineId} — ${input.description}`.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        paddingAll: "18px",
        contents: [
          text("SMART VENDING", { color: "#FFFFFF", size: "xs", weight: "bold" }),
          text(title, { color: "#FFFFFF", size: "xl", weight: "bold", margin: "sm" }),
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          text(`เครื่อง: ${input.machineId}`, { weight: "bold", wrap: true }),
          text(`อุปกรณ์: ${input.affectedHardware}`, { wrap: true }),
          text(input.description, { color: "#0F172A", weight: "bold", wrap: true }),
          text(`ตรวจพบครั้งแรก: ${bangkokDateTime(input.detectedAt)}`, {
            color: "#475569",
            size: "sm",
            wrap: true,
          }),
          { type: "separator", color: "#E2E8F0" },
          text(`คำแนะนำ: ${input.recommendedAction}`, {
            color: "#334155",
            size: "sm",
            wrap: true,
          }),
        ],
      },
    },
  };
}
