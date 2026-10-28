# Task 62.3A — โครงร่างการนำเสนอ Smart Vending Machine

**ระยะเวลาเป้าหมาย:** 8–12 นาที  
**จำนวนสไลด์:** 10 สไลด์  
**กลุ่มผู้ฟัง:** อาจารย์นิเทศ อาจารย์ที่ปรึกษา และผู้ประเมินโครงงานสหกิจ  
**สถานะ:** รอ Tech Lead ตรวจทานและแนบหลักฐานที่ปกปิดข้อมูลสำคัญแล้ว

## หลักการใช้หลักฐาน

- **Automated:** ผลทดสอบซอฟต์แวร์ ไม่ใช่หลักฐานว่าอุปกรณ์จริงขยับ
- **Physical:** ผู้ปฏิบัติงานเห็นผลกับตู้จริง
- **Railway DB:** ตรวจแบบ read-only จากฐานข้อมูล Production
- **Pending/Waiver:** ต้องบอกข้อจำกัดตรงไปตรงมา ห้ามเปลี่ยนเป็น PASS

## สไลด์ 1 — ปัญหาและเป้าหมายของโครงงาน

**เวลาประมาณ:** 45–60 วินาที

### ประเด็นหลัก

- สร้างต้นแบบตู้จำหน่ายสินค้าอัตโนมัติ 1 ตู้ 3 ช่อง สำหรับการสาธิตในมหาวิทยาลัย
- เชื่อมการเลือกสินค้า ชำระเงิน เปิดล็อก ยืนยันพนักงาน เติมสินค้า และแจ้งเตือน
- เป้าหมายสำคัญคือความถูกต้องของสถานะและการกู้คืน ไม่ใช่การเปิดให้บริการเชิงพาณิชย์
- ใช้ Opn Test Mode และมีผู้ควบคุมดูแลตลอดการสาธิต

### ภาพที่แนะนำ

- ภาพตู้จริงมุมกว้าง พร้อมป้าย Slot 1–3
- แถบเล็กด้านล่าง: `University Prototype / Supervised / Opn Test Mode`

### บันทึกผู้พูด

“โครงงานนี้ทดสอบวงจรงานครบตั้งแต่ลูกค้าเลือกสินค้าไปจนถึงพนักงานเติมสินค้า
และระบบแจ้งเตือน แต่ขอบเขตคือเครื่องต้นแบบหนึ่งตู้ภายใต้การควบคุม ไม่ใช่ระบบ
Production สำหรับใช้งานโดยไม่มีผู้ดูแล”

### แหล่งหลักฐาน

- `docs/project-spec.md`
- `docs/task62-final-presentation-handover.md`
- Operator-confirmed final physical acceptance

## สไลด์ 2 — ขอบเขตฮาร์ดแวร์และซอฟต์แวร์

**เวลาประมาณ:** 55–70 วินาที

### ประเด็นหลัก

- Raspberry Pi 3B+: Chromium Kiosk, Cloud Relay, Face/Hardware/Audio Service
- ESP32: ควบคุม Relay/Solenoid 3 ช่อง อ่าน Reed และ IR อย่างละ 3 ตัว
- Webcam สำหรับ Face Recognition และ Head-turn Challenge
- USB Speaker สำหรับเสียงภาษาไทย
- React/Vite, Express/TypeScript, Prisma/PostgreSQL, Python/Flask/OpenCV

### ภาพที่แนะนำ

- ภาพตู้พร้อมลูกศรชี้ Pi, ESP32, Webcam, Speaker, Solenoid, Reed, IR
- ตารางเล็ก: Slot 1 Tissue THB 20, Slot 2 Sanitary Pad THB 25, Slot 3 Wet Wipes THB 30

### บันทึกผู้พูด

“Pi ทำงานระดับแอปและกล้อง ส่วน ESP32 ทำงานระดับ GPIO และ Serial การแยกหน้าที่นี้
ช่วยไม่ให้โค้ด Cloud ควบคุมขา Relay โดยตรง และ Firmware มี interlock ไม่ให้เปิด
มากกว่าหนึ่งช่องพร้อมกัน”

### แหล่งหลักฐาน

- `README.md`
- `firmware/vending_esp32.ino`
- `docs/task55-firmware-hardware-source-of-truth.md`
- `docs/serial-protocol.md`

## สไลด์ 3 — สถาปัตยกรรมที่ใช้งานจริง

**เวลาประมาณ:** 60–75 วินาที

### ประเด็นหลัก

- Kiosk เรียก Pi Cloud Relay ที่ `127.0.0.1:3000`
- Relay ส่งเฉพาะ route ที่อนุญาตผ่าน Cloudflare Service Auth ไป Railway
- Railway Backend และ PostgreSQL เป็นศูนย์กลางข้อมูลธุรกิจ
- Hardware/Face/Audio API อยู่ที่ `127.0.0.1:5000` และห้ามเปิดสู่ Cloud/LAN
- Staff/Admin เข้า hostname สำหรับมนุษย์ผ่าน Cloudflare Access
- Opn Webhook เป็นข้อยกเว้นสาธารณะเฉพาะ path ที่ลงลายเซ็นแล้ว

### แผนภาพที่แนะนำ

```text
Customer Kiosk → Pi Relay → Cloudflare → Railway API/PostgreSQL → Opn/LINE
       │
       └→ Pi Local API → ESP32 / Camera / Speaker

Staff/Admin Browser → Human Cloudflare Access → Railway
```

### บันทึกผู้พูด

“Cloud ไม่ได้ยิงคำสั่งเข้าหาอุปกรณ์โดยตรง Pi เป็นฝ่ายเริ่มการเชื่อมต่อออกไป และ
Browser ไม่เห็น Service Token ส่วนคำสั่งเปิดล็อกไม่อยู่ใน Cloud Relay แต่ต้องผ่าน
Local API เท่านั้น”

### แหล่งหลักฐาน

- `docs/pi-cloud-relay.md`
- `docs/staff-admin-cloud.md`
- `docs/pi-autostart.md`
- `deploy/systemd/*.service`

## สไลด์ 4 — ขั้นตอนซื้อสินค้าและผู้มีอำนาจตัดสินการชำระเงิน

**เวลาประมาณ:** 60–75 วินาที

### ประเด็นหลัก

1. ลูกค้าเลือกเฉพาะ Slot ที่ `AVAILABLE`
2. Backend อ่านสินค้าและราคาจาก PostgreSQL แล้วสร้าง Opn PromptPay QR
3. Backend ตรวจ Charge จาก Opn ไม่เชื่อสถานะจาก Browser หรือ Webhook body
4. `Transaction=SUCCESS` และ Slot ที่ซื้อ=`SOLD_OUT` ใน Database transaction เดียว
5. จากนั้น Kiosk จึงสั่ง Pi เปิด Slot ที่ถูกต้องและเล่นเสียงภาษาไทย
6. Operational LINE OA รับยอดขายและสินค้าคงเหลือ

### ภาพที่แนะนำ

- Sequence diagram 6 ขั้นตอน
- ภาพ Kiosk ก่อนซื้อ → QR ที่ปกปิดแล้ว → Success → Slot SOLD_OUT

### บันทึกผู้พูด

“ผู้มีอำนาจยืนยันการชำระเงินคือ Opn ที่ Backend ดึงข้อมูลมาตรวจอีกครั้ง ไม่ใช่ QR
ไม่ใช่ Browser และไม่ใช่ ESP32 การเอาสินค้าออกจากช่องไม่ใช่เงื่อนไขจบการขาย”

### แหล่งหลักฐาน

- `docs/opn-payments.md`
- Backend payment/reconciliation tests
- Physical acceptance: purchases Slots 1–3, correct solenoid and Thai audio
- Railway reconciliation: 3 SUCCESS transactions, total THB 75

## สไลด์ 5 — การยืนยันพนักงานและเติมสินค้า

**เวลาประมาณ:** 60–75 วินาที

### ประเด็นหลัก

- Staff Portal สร้าง `RESTOCK_AUTH` session ระยะสั้น
- Pi ตรวจใบหน้า EMP001 และ Head-turn/Return-to-center ภายในเครื่อง
- Railway ตรวจซ้ำว่า session และพนักงานยัง active
- Reed ยืนยันการเปิด/ปิดฝา; IR ยืนยันมีสินค้า
- เมื่อครบทั้ง 3 ช่อง Backend สร้าง RestockLog และเปลี่ยนทั้งหมดเป็น `AVAILABLE`
- Face Template อยู่ใน Pi; Cloud Face Template Sync ยัง deferred

### ภาพที่แนะนำ

- Flow diagram: Staff → Session → Face → Sensors → RestockLog → AVAILABLE
- ภาพหน้าจอที่ไม่เก็บ/เปิดเผยใบหน้าจริง

### บันทึกผู้พูด

“ผล Match จาก Pi อย่างเดียวไม่เพียงพอ Backend ต้องตรวจ employee และ session อีกครั้ง
ข้อมูล biometric ไม่ส่งขึ้น Railway ส่วน `faceRegistered` เป็นเพียง metadata ของ workflow”

### แหล่งหลักฐาน

- `docs/project-spec.md`
- `docs/pi-face-recognition.md`
- `docs/pi-unlock-service.md`
- Physical acceptance: EMP001 และ Restock 3 ช่อง
- Railway reconciliation: RestockLog `SOLD_OUT → AVAILABLE`, final slots AVAILABLE

## สไลด์ 6 — LINE OA และระบบติดตามสถานะ Pi

**เวลาประมาณ:** 50–65 วินาที

### ประเด็นหลัก

- Operational OA: แจ้งการขาย สินค้าคงเหลือ และ Restock
- Owner OA: รายงาน Daily/Weekly ตามเวลาเท่านั้น ไม่รับแจ้งทุกการขาย
- VendingMaintenance OA: แจ้ง Pi `OFFLINE` และ `RECOVERED`
- Heartbeat ประมาณทุก 30 วินาที วัดการเชื่อมต่อ Relay → Cloud เท่านั้น
- ผลจริง: OFFLINE ≈4 นาที, RECOVERED ≈1 นาที

### ภาพที่แนะนำ

- ภาพ LINE 3 คอลัมน์ โดยปกปิด recipient/request ID
- Timeline: Last heartbeat → candidate → OFFLINE → new heartbeat → RECOVERED

### บันทึกผู้พูด

“เราแยก Channel Token ตามหน้าที่ ลดความเสี่ยงส่งผิดผู้รับ และ Monitoring นี้ไม่ได้
อ้างว่าวัด Solenoid, Sensor, Camera หรือ Chromium แต่บอกได้ว่า Pi Relay ยังติดต่อ
Cloud ได้หรือไม่”

### แหล่งหลักฐาน

- `docs/phase2-owner-sales-reports.md`
- `docs/phase3-hardware-monitoring.md`
- Physical acceptance and read-only Railway alert reconciliation

## สไลด์ 7 — ความปลอดภัยและการกู้คืน

**เวลาประมาณ:** 55–70 วินาที

### ประเด็นหลัก

- Cloudflare Human Access และ Pi Service Auth แยกกัน
- Pi Relay allowlist route; Hardware API loopback-only
- Backend/Database เป็น authority; ระบบ fail closed เมื่อ Face/Camera/Network ไม่แน่นอน
- Refresh Guard และ persisted payment recovery ป้องกันการทำงานซ้ำใน flow ปกติ
- systemd และ Chromium autostart ช่วยกู้คืนหลัง cold reboot
- ถ้าจ่ายสำเร็จแต่ผล Unlock ไม่แน่นอน: ขอความช่วยเหลือจากพนักงาน ห้าม retry `/unlock`

### ภาพที่แนะนำ

- ตาราง “Failure → Safe response” 4 แถว
- โล่ 3 ชั้น: Cloudflare → Backend validation → Loopback/local hardware

### บันทึกผู้พูด

“Recovery ไม่ได้แปลว่า retry ทุกอย่าง โดยเฉพาะคำสั่งเปิดล็อก ถ้าผลไม่แน่นอนระบบต้อง
หยุดและให้พนักงานตรวจสอบ เพราะการ retry อาจเปิดซ้ำได้หลัง service restart”

### แหล่งหลักฐาน

- `docs/pi-cloud-relay.md`
- `docs/task56-power-reboot-acceptance.md`
- `frontend/src/active-payment-recovery.mjs`
- Physical acceptance: Refresh Guard and normal cold reboot PASS

## สไลด์ 8 — ผล Acceptance และหลักฐาน

**เวลาประมาณ:** 60–80 วินาที

### ประเด็นหลัก

- Physical: Boot/Kiosk, EMP001, ซื้อครบ 3 Slots, Solenoid, Thai audio, Restock, LINE, Monitoring PASS
- Railway: 3 SUCCESS transactions, THB 75, RestockLog, ทุก Slot AVAILABLE
- Backend regression: **193/193 PASS**
- Frontend regression: **138/138 PASS**
- Python Fake Serial: **5 tests PASS, 6 subtests PASS**
- Refresh Guard และ normal cold reboot PASS

### ภาพที่แนะนำ

- Evidence matrix 3 คอลัมน์: Automated / Physical / Railway DB
- ตัวเลขขนาดใหญ่: `3 Transactions | THB 75 | 3 Slots AVAILABLE`

### บันทึกผู้พูด

“Automated test พิสูจน์ logic, Physical test พิสูจน์อุปกรณ์จริง และ Railway query
พิสูจน์ข้อมูลธุรกิจ ทั้งสามประเภทเสริมกัน แต่ไม่ใช้แทนกัน”

### แหล่งหลักฐาน

- Final supplied regression logs
- `docs/task62-final-e2e-acceptance.md`
- Task 62.3A confirmed operator and Railway reconciliation
- `edge/tests/test_task56_f3_acceptance.py`

## สไลด์ 9 — ข้อจำกัดที่ต้องบอกอย่างตรงไปตรงมา

**เวลาประมาณ:** 60–75 วินาที

### ประเด็นหลัก

- **T62-U03 FAIL + ACCEPTED PROTOTYPE WAIVER**
- Deduplication ของ Pi เป็น process-local; explicit retry หลัง service restart อาจส่ง `OPEN` ซ้ำ
- Opn เป็น Test Mode ไม่ใช่ Live Mode
- Weekly scheduled report ยัง **PENDING**
- Cloud Face Template Sync ยัง deferred
- Head-turn challenge ไม่ใช่ biometric PAD ระดับ Production
- Monitoring วัด connectivity เท่านั้น และไม่มี automatic refund

### ภาพที่แนะนำ

- ตารางสี: Accepted / Waived / Pending / Deferred
- หลีกเลี่ยงเครื่องหมายถูกสำหรับ U03 และ Weekly

### บันทึกผู้พูด

“Cold reboot ผ่านไม่ได้ลบผล FAIL ของ crash window การสาธิตปกติไม่พบการเปิดซ้ำเอง
แต่เราไม่อ้าง durable exactly-once และ waiver นี้ใช้ไม่ได้กับระบบ Production ที่ไม่มีผู้ดูแล”

### แหล่งหลักฐาน

- `docs/task56-power-reboot-acceptance.md`
- `docs/task62-final-e2e-acceptance.md`
- `frontend/tests/task56-f3-acceptance.test.mjs`
- `edge/tests/test_task56_f3_acceptance.py`
- `docs/phase2-owner-sales-reports.md`

## สไลด์ 10 — สรุป คุณค่าที่ส่งมอบ และขั้นตอนต่อไป

**เวลาประมาณ:** 45–60 วินาที

### ประเด็นหลัก

- ส่งมอบ E2E prototype ที่เชื่อม Cloud, Payment, IoT, Face, Inventory และ LINE
- Core Physical E2E Acceptance ผ่านสำหรับตู้ต้นแบบหนึ่งตู้
- ส่งมอบ Runbook, Evidence Map, Recovery Checklist และ Handover Checklist
- ขั้นต่อไป: แนบหลักฐาน/ภาพ, ซ้อม 8–12 นาที, Tech Lead sign-off
- หลังโครงงาน: ตรวจ Weekly run, durable fulfillment, RBAC, PAD, Live Mode และ multi-cabinet

### ภาพที่แนะนำ

- ภาพตู้จริง + สรุป `PASS / WAIVER / PENDING`
- QR ไปยัง repository documentation เฉพาะเมื่อไม่มี secret และได้รับอนุญาต

### บันทึกผู้พูด

“ผลสำเร็จของโครงงานคือการทำให้หลายระบบทำงานร่วมกันโดยกำหนด authority และ
failure behavior ชัดเจน พร้อมยอมรับข้อจำกัดที่ยังไม่เหมาะกับ Production”

### แหล่งหลักฐาน

- `docs/task62-final-presentation-handover.md`
- Final acceptance evidence pack
- Tech Lead review/sign-off

## แผนเวลาโดยรวม

| สไลด์ | เวลาเป้าหมาย |
| ---: | ---: |
| 1 | 0:50 |
| 2 | 1:00 |
| 3 | 1:05 |
| 4 | 1:10 |
| 5 | 1:10 |
| 6 | 0:55 |
| 7 | 1:05 |
| 8 | 1:10 |
| 9 | 1:05 |
| 10 | 0:50 |
| **รวม** | **ประมาณ 10:20 นาที** |

## รายการภาพ/หลักฐานที่ต้องเตรียมก่อนทำสไลด์จริง

- [ ] ภาพตู้จริงและภาพ Hardware ที่ติดป้ายแล้ว
- [ ] วิดีโอ Cold Boot และ Chromium Kiosk
- [ ] ภาพ Kiosk แสดงสินค้า 3 Slots
- [ ] ภาพ EMP001 enrollment/authentication ที่ไม่เปิดเผย biometric data
- [ ] ภาพ Opn Test Mode และ Webhook ที่ปกปิด QR/secret
- [ ] วิดีโอ correct-slot unlock และ Thai audio
- [ ] ภาพ Operational LINE sale/inventory/restock
- [ ] ภาพ VendingMaintenance OFFLINE/RECOVERED พร้อมเวลา
- [ ] ภาพ Railway read-only reconciliation ที่ปกปิด DB URL/credentials
- [ ] Console logs: Backend 193, Frontend 138, Python 5 tests/6 subtests
- [ ] หลักฐาน Refresh Guard และ normal cold reboot
- [ ] เอกสาร waiver ของ T62-U03 ที่ Tech Lead อนุมัติ

## กติกาสำหรับการสาธิตสด

1. ใช้ Opn Test Mode และธุรกรรมที่อนุมัติไว้เท่านั้น
2. ไม่เปิดเผย QR เก่าหรือ secret ในสไลด์/วิดีโอ
3. ไม่ restart Pi Unlock Service ระหว่างการขาย
4. ไม่ retry `/unlock` เมื่อไม่ทราบผลเดิม
5. ไม่ส่ง LINE ซ้ำเพื่อโชว์ ถ้ามีหลักฐานเดิมให้ใช้ภาพแทน
6. ถ้า Network/Payment/Unlock ไม่แน่นอน ให้หยุด live flow และใช้ fallback evidence
7. ปิดท้ายด้วย U03 FAIL, Weekly PENDING, Opn Test Mode และ Face Sync deferred ทุกครั้ง
