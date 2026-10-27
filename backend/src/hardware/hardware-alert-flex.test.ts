import assert from "node:assert/strict";
import test from "node:test";
import {
  bangkokDateTime,
  createHardwareAlertFlex,
  HARDWARE_CONNECTIVITY_COPY,
  type HardwareAlertMessageInput,
} from "./hardware-alert-flex";

const MACHINE_ID = "PILOT_KIOSK";
const AFFECTED_SYSTEM = "Pi Cloud Relay";

function expectedPayload(input: HardwareAlertMessageInput, title: string, color: string) {
  return {
    type: "flex",
    altText: `${title} — ${input.machineId} — ${input.description}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        paddingAll: "18px",
        contents: [
          { type: "text", text: "SMART VENDING", color: "#FFFFFF", size: "xs", weight: "bold" },
          {
            type: "text",
            text: title,
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          { type: "text", text: `รหัสเครื่อง: ${input.machineId}`, weight: "bold", wrap: true },
          { type: "text", text: `ระบบที่ติดตาม: ${input.affectedHardware}`, wrap: true },
          {
            type: "text",
            text: input.description,
            color: "#0F172A",
            weight: "bold",
            wrap: true,
          },
          {
            type: "text",
            text: `ตรวจพบครั้งแรก: ${bangkokDateTime(input.detectedAt)}`,
            color: "#475569",
            size: "sm",
            wrap: true,
          },
          { type: "separator", color: "#E2E8F0" },
          {
            type: "text",
            text: `คำแนะนำ: ${input.recommendedAction}`,
            color: "#334155",
            size: "sm",
            wrap: true,
          },
        ],
      },
    },
  };
}

test("OFFLINE maintenance Flex payload uses precise Thai connectivity wording", () => {
  const input: HardwareAlertMessageInput = {
    machineId: MACHINE_ID,
    severity: "CRITICAL",
    affectedHardware: AFFECTED_SYSTEM,
    ...HARDWARE_CONNECTIVITY_COPY.OFFLINE,
    detectedAt: new Date("2026-10-27T03:29:15.343Z"),
  };

  const message = createHardwareAlertFlex(input);

  assert.deepEqual(message, expectedPayload(input, "ระบบขัดข้อง", "#B91C1C"));
  assert.equal(input.description, "เครื่องจำหน่ายสินค้าขาดการติดต่อ");
  assert.match(input.recommendedAction, /ไม่ได้รับ Heartbeat เท่านั้น/);
  assert.match(input.recommendedAction, /ยังไม่ยืนยันว่าอุปกรณ์เสียหายหรือไฟฟ้าดับ/);
  assert.doesNotMatch(JSON.stringify(message), /ระบบขัดข้องระดับวิกฤต/);
});

test("RECOVERED maintenance Flex payload uses Thai recovery wording", () => {
  const input: HardwareAlertMessageInput = {
    machineId: MACHINE_ID,
    severity: "RECOVERED",
    affectedHardware: AFFECTED_SYSTEM,
    ...HARDWARE_CONNECTIVITY_COPY.RECOVERED,
    detectedAt: new Date("2026-10-27T03:32:09.542Z"),
  };

  const message = createHardwareAlertFlex(input);

  assert.deepEqual(message, expectedPayload(input, "ระบบกลับมาทำงานปกติ", "#15803D"));
  assert.match(input.description, /กลับมาเป็น Online$/);
  assert.match(input.recommendedAction, /ติดตาม Heartbeat ต่อเนื่อง/);
});
