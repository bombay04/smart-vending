# Smart Vending Machine: Full System Test Guide

คู่มือนี้รวมคำสั่งสำหรับทดสอบระบบบน PC, Raspberry Pi, ESP32 และ Customer Frontend ตั้งแต่เริ่มเปิดระบบจนถึง Hardware E2E

## ภาพรวมเครื่องที่ใช้

| เครื่อง | หน้าที่ | Service |
| --- | --- | --- |
| PC หลัก | PostgreSQL และ Backend | `localhost:5435`, `localhost:3000` |
| Raspberry Pi | Frontend, Pi Unlock Service และ USB Serial | `localhost:5173`, `localhost:5000` |
| ESP32 | ควบคุม Lock และอ่าน Sensor | USB Serial `115200` baud |

ตัวอย่างในคู่มือนี้ใช้:

- PC IP: `172.25.1.52`
- Pi IP: `172.25.1.58`
- ESP32 Serial: `/dev/ttyUSB0`

ให้เปลี่ยน IP และ Serial port ให้ตรงกับเครื่องจริง

> `localhost` หมายถึงเครื่องที่กำลังรันคำสั่งหรือ Browser นั้น เช่น `localhost` บน Pi ไม่ใช่ PC หลัก

## 1. เตรียมระบบบน PC หลัก

คำสั่งส่วนนี้ใช้ Git Bash บน Windows

### 1.1 อัปเดต repository

```bash
cd /c/smart-vending
git checkout main
git pull origin main
```

ก่อน `git checkout` หรือ `git pull` ควรตรวจสอบว่าไม่มีงานที่ยังไม่ได้ commit:

```bash
git status --short
```

### 1.2 เปิด PostgreSQL Docker

รันจาก project root:

```bash
cd /c/smart-vending
docker compose up -d
docker ps
```

ควรเห็น container:

```text
smart-vending-postgres
```

### 1.3 เปิด Backend

PC Terminal 1:

```bash
cd /c/smart-vending/backend
npm install
npm run dev
```

ปล่อย Terminal นี้ทำงานค้างไว้

### 1.4 ตรวจ Backend

PC Terminal 2:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/slots
```

Health response ที่คาดหวัง:

```json
{"status":"ok","database":"connected","timestamp":"..."}
```

### 1.5 Reset Slots ให้เป็น AVAILABLE

วิธีที่ใช้ได้กับ seed ปัจจุบัน:

```bash
cd /c/smart-vending/backend
npm run seed
curl http://localhost:3000/api/v1/slots
```

Seed จะตั้ง Slot 1–3 เป็น `AVAILABLE` และเชื่อม Product เดิมกลับเข้า Slot

อีกวิธีคือ Restock API:

```bash
curl -X POST http://localhost:3000/api/v1/restocks/mock \
  -H "Content-Type: application/json" \
  -d '{"employeeId":1}'
```

> Restock API ใช้ได้เมื่อมี Employee ID `1` และ Employee ยัง active เท่านั้น แต่ seed ปัจจุบันไม่ได้สร้าง Employee หากได้รับ `Employee not found.` ให้ใช้ `npm run seed` สำหรับ reset demo แทน

ตรวจผล:

```bash
curl http://localhost:3000/api/v1/slots
```

ควรเห็น Slot 1, 2 และ 3 เป็น `AVAILABLE`

### 1.6 หา IP ของ PC

```powershell
ipconfig
```

เลือก IPv4 Address ที่ Pi เข้าถึงได้ เช่น:

```text
172.25.1.52
```

Backend URL สำหรับ Pi คือ:

```text
http://172.25.1.52:3000
```

หาก Pi เรียกไม่ได้ ให้ตรวจ Windows Firewall ว่าอนุญาต Node.js/TCP port `3000` บนเครือข่ายที่ใช้อยู่

## 2. เตรียม repository บน Raspberry Pi

```bash
cd ~/smart-vending
git status --short
git checkout main
git pull origin main
```

ตรวจว่า Pi ติดต่อ Backend บน PC ได้ โดยเปลี่ยน IP ให้ตรงกับ PC:

```bash
curl http://172.25.1.52:3000/health
curl http://172.25.1.52:3000/api/v1/slots
```

ถ้าทั้งสองคำสั่งตอบกลับ แปลว่าเส้นทาง Pi → Backend PC พร้อมใช้งาน

## 3. ตรวจ ESP32 Serial Port บน Pi

ต่อสาย:

```text
Raspberry Pi → USB → ESP32
```

ตรวจ port:

```bash
ls /dev/ttyUSB* 2>/dev/null || echo "No ttyUSB"
ls /dev/ttyACM* 2>/dev/null || echo "No ttyACM"
```

ค่าที่พบบ่อย:

- `/dev/ttyUSB0`
- `/dev/ttyACM0`

หากพบ Permission denied ภายหลัง ให้เพิ่ม user เข้า group `dialout` แล้ว logout/login ใหม่:

```bash
sudo usermod -aG dialout "$USER"
```

## 4. สร้าง Python Virtual Environment บน Pi

```bash
cd ~/smart-vending
python3 -m venv .venv
```

ถ้าไม่มี module `venv`:

```bash
sudo apt update
sudo apt install -y python3-venv
python3 -m venv .venv
```

Activate และติดตั้ง dependencies:

```bash
source .venv/bin/activate
python -m pip install -r edge/requirements.txt
```

เมื่อ activate สำเร็จ prompt จะมี `(.venv)` นำหน้า

## 5. ทดสอบ Serial CLI โดยตรง

ก่อนเปิด Serial CLI ต้องปิด Arduino Serial Monitor และ Pi Unlock Service เพราะหนึ่ง Serial port ไม่ควรถูกเปิดพร้อมกันหลายโปรแกรม

บน Pi:

```bash
cd ~/smart-vending
source .venv/bin/activate
python edge/serial_test.py --port /dev/ttyUSB0
```

ถ้าเป็น `/dev/ttyACM0`:

```bash
python edge/serial_test.py --port /dev/ttyACM0
```

บน Windows ที่ต่อ ESP32 เป็น COM8:

```powershell
python edge/serial_test.py --port COM8
```

คำสั่งภายใน CLI:

```text
PING
GET_STATUS
OPEN:1
OPEN:2
OPEN:3
```

ตัวอย่าง response:

```text
ESP32> [UNKNOWN] PONG
ESP32> [DOOR] DOOR:1:CLOSED
ESP32> [IR] IR:1:EMPTY
ESP32> [ACK] ACK:OPEN:1
ESP32> [LOCK] LOCK:1:OPENED
ESP32> [LOCK] LOCK:1:CLOSED
```

> ใน `serial_test.py` เวอร์ชันปัจจุบัน `PONG` ยังถูกจัดประเภทเป็น `UNKNOWN` แต่ข้อความ `PONG` จาก ESP32 ยังถือว่าถูกต้อง

ออกจาก CLI:

```text
exit
```

> เพื่อความปลอดภัย ให้ทดสอบ `OPEN` ทีละช่อง เว้นช่วงให้กลไกและคอยล์คืนสถานะ และหยุดทันทีหากมีความร้อนผิดปกติ กลิ่นไหม้ เสียงหึ่ง หรือกลไกค้าง

### Serial parser self-test

คำสั่งที่วางแผนไว้คือ:

```bash
python edge/serial_test.py --self-test
```

แต่ `serial_test.py` ใน revision ปัจจุบันยังไม่มี option `--self-test` จึงไม่ควรใช้คำสั่งนี้จนกว่าจะนำ refactor จาก Task 25 กลับมา

## 6. เปิด Pi Unlock Service ด้วย ESP32 จริง

ปิด Serial CLI ก่อน จากนั้นเปิด Pi Terminal 1:

```bash
cd ~/smart-vending
source .venv/bin/activate
ESP32_SERIAL_PORT=/dev/ttyUSB0 python edge/pi_unlock_service.py
```

ถ้าใช้ `/dev/ttyACM0`:

```bash
ESP32_SERIAL_PORT=/dev/ttyACM0 python edge/pi_unlock_service.py
```

Expected log:

```text
Connecting to ESP32 on /dev/ttyUSB0 at 115200 baud
ESP32 serial connection established
Service listening on http://127.0.0.1:5000
```

ปล่อย Terminal นี้ทำงานค้างไว้

### 6.1 ตรวจ Health

Pi Terminal 2:

```bash
curl http://localhost:5000/health
```

Expected:

```json
{"hardware":"connected","mockHardware":false,"status":"ok"}
```

### 6.2 ทดสอบ Unlock

Slot 1:

```bash
curl -X POST http://localhost:5000/unlock \
  -H "Content-Type: application/json" \
  -d '{"slotNumber":1}'
```

Slot 2 และ 3:

```bash
curl -X POST http://localhost:5000/unlock \
  -H "Content-Type: application/json" \
  -d '{"slotNumber":2}'

curl -X POST http://localhost:5000/unlock \
  -H "Content-Type: application/json" \
  -d '{"slotNumber":3}'
```

Expected response:

```json
{"data":{"mockHardware":false,"slotNumber":1,"status":"UNLOCK_COMMAND_SENT"}}
```

> Response นี้หมายถึง Python เขียนคำสั่งลง Serial แล้วเท่านั้น Service ปัจจุบันยังไม่ได้รอจับคู่ `ACK`, `ERROR:BUSY` หรือยืนยันว่ากลไกเปิดจริง

## 7. Mock Mode เมื่อไม่มี ESP32

ปิด service ตัวเดิมก่อน แล้วรัน:

```bash
cd ~/smart-vending
source .venv/bin/activate
MOCK_HARDWARE=true python edge/pi_unlock_service.py
```

ตรวจ Health และ Unlock:

```bash
curl http://localhost:5000/health

curl -X POST http://localhost:5000/unlock \
  -H "Content-Type: application/json" \
  -d '{"slotNumber":1}'
```

Expected:

```json
{"hardware":"mock","mockHardware":true,"status":"ok"}
```

```json
{"data":{"mockHardware":true,"slotNumber":1,"status":"UNLOCK_COMMAND_SENT"}}
```

## 8. แก้ปัญหา Port 5000 ถูกใช้งาน

ตรวจ process:

```bash
sudo ss -ltnp | grep :5000
```

ถ้ามี `lsof`:

```bash
sudo lsof -i :5000
```

หยุดเฉพาะ Pi Unlock Service เก่า:

```bash
pkill -f pi_unlock_service.py
```

ตรวจว่า port ว่าง:

```bash
sudo ss -ltnp | grep :5000
```

ถ้าไม่มี output ให้เปิด service ใหม่ตามหัวข้อ 6 หรือ 7

## 9. ตั้งค่า Frontend บน Pi

เปิดไฟล์ local environment:

```bash
cd ~/smart-vending/frontend
nano .env
```

ตัวอย่างเมื่อ Backend อยู่ PC `172.25.1.52` และ Browser เปิดบนจอ Pi:

```dotenv
VITE_API_BASE_URL=http://172.25.1.52:3000
VITE_PI_UNLOCK_BASE_URL=http://localhost:5000
```

ความหมาย:

- `VITE_API_BASE_URL` ชี้ไป Backend บน PC
- `VITE_PI_UNLOCK_BASE_URL` ชี้ไป Pi Unlock Service บนเครื่องเดียวกับ Browser

บันทึก nano ด้วย `Ctrl+O`, `Enter`, `Ctrl+X`

> `.env` เป็นไฟล์เฉพาะเครื่องและไม่ควร commit หลังแก้ `.env` ต้อง restart Vite ทุกครั้ง

## 10. เปิด Frontend บน Pi

Pi Terminal 3:

```bash
cd ~/smart-vending/frontend
npm install
npm run dev -- --host 0.0.0.0
```

Expected:

```text
Local:   http://localhost:5173/
Network: http://<PI_IP>:5173/
```

เปิด Chromium บนจอ Pi:

```text
http://localhost:5173
```

## 11. Customer Hardware E2E Test

ต้องมี 3 process ทำงานพร้อมกัน:

### PC Terminal: Backend

```bash
cd /c/smart-vending/backend
npm run dev
```

### Pi Terminal 1: Unlock Service

```bash
cd ~/smart-vending
source .venv/bin/activate
ESP32_SERIAL_PORT=/dev/ttyUSB0 python edge/pi_unlock_service.py
```

### Pi Terminal 2: Frontend

```bash
cd ~/smart-vending/frontend
npm run dev -- --host 0.0.0.0
```

### Browser บน Pi

```text
http://localhost:5173
```

Expected flow เมื่อกด Buy Slot 1:

1. ปุ่มแสดง `Processing...`
2. Frontend เรียก Backend บน PC
3. Backend สร้าง mock purchase และเปลี่ยน Slot เป็น `SOLD_OUT`
4. Frontend เรียก Pi Unlock Service ที่ `localhost:5000`
5. Pi ส่ง `OPEN:1` ไป ESP32
6. Lock 1 เปิด
7. หน้าเว็บแสดง `Purchase successful. Slot 1 unlocked.`
8. Slot 1 เปลี่ยนเป็น `SOLD_OUT`

ทำซ้ำกับ Slot 2 และ 3 โดยเว้นช่วงตามข้อกำหนดของ firmware และตัวล็อค

## 12. Reset Demo

วิธีที่แนะนำบน PC:

```bash
cd /c/smart-vending/backend
npm run seed
```

หรือใช้ Restock API เมื่อ Employee ID `1` มีอยู่จริง:

```bash
curl -X POST http://localhost:3000/api/v1/restocks/mock \
  -H "Content-Type: application/json" \
  -d '{"employeeId":1}'
```

จากนั้น refresh หน้า Customer Frontend และตรวจว่า Slot 1–3 เป็น `AVAILABLE`

## 13. แก้ปัญหา Frontend แสดง Failed to load slots

ตรวจจาก Pi:

```bash
curl http://172.25.1.52:3000/health
curl http://172.25.1.52:3000/api/v1/slots
```

ตรวจค่า Frontend:

```bash
cd ~/smart-vending/frontend
cat .env
```

ควรเป็น:

```dotenv
VITE_API_BASE_URL=http://172.25.1.52:3000
VITE_PI_UNLOCK_BASE_URL=http://localhost:5000
```

หลังแก้ให้หยุด Vite ด้วย `Ctrl+C` แล้วเปิดใหม่:

```bash
npm run dev -- --host 0.0.0.0
```

ถ้า curl จาก Pi ใช้ไม่ได้ ให้ตรวจ:

- Backend ยังทำงานอยู่
- PC IP ไม่เปลี่ยน
- PC และ Pi อยู่เครือข่ายเดียวกัน
- Windows Firewall อนุญาต TCP port `3000`

## 14. แก้ปัญหา Browser บน Pi ช้าหรือค้าง

ตรวจว่า Vite ตอบอยู่:

```bash
curl -I http://localhost:5173
curl http://localhost:5173 | head
```

ถ้าได้ HTTP `200` และ HTML ให้ลองเปิด Chromium ใหม่ด้วย profile ชั่วคราว:

```bash
pkill chromium
chromium --user-data-dir=/tmp/smart-vending-chrome --disable-gpu http://localhost:5173
```

ถ้า command คือ `chromium-browser`:

```bash
chromium-browser --user-data-dir=/tmp/smart-vending-chrome --disable-gpu http://localhost:5173
```

หลีกเลี่ยง `--no-sandbox` เว้นแต่จำเป็นจริงและเข้าใจความเสี่ยงด้านความปลอดภัย

## 15. Debug ผ่าน SSH Tunnel

บน Pi เปิด Unlock Service และ Frontend โดย Frontend สามารถ bind เฉพาะ localhost:

```bash
cd ~/smart-vending/frontend
npm run dev
```

บน PC ที่จะเปิด Browser:

```bash
ssh -L 5173:localhost:5173 -L 5000:localhost:5000 user@172.25.1.58
```

ปล่อย SSH Terminal ค้างไว้ แล้วตรวจ:

```bash
curl http://localhost:5173
curl http://localhost:5000/health
```

เปิด Browser บน PC:

```text
http://localhost:5173
```

ค่า `.env` บน Pi ยังคงเป็น:

```dotenv
VITE_API_BASE_URL=http://172.25.1.52:3000
VITE_PI_UNLOCK_BASE_URL=http://localhost:5000
```

Browser บน PC จะเห็น `localhost:5000` ผ่าน SSH tunnel ไปยัง Pi

## 16. Quick Full Test Checklist

### PC

- [ ] `docker compose up -d`
- [ ] เห็น `smart-vending-postgres` ใน `docker ps`
- [ ] Backend `npm run dev` ทำงาน
- [ ] `curl localhost:3000/health` ผ่าน
- [ ] Slot 1–3 เป็น `AVAILABLE`

### Raspberry Pi

- [ ] พบ ESP32 ที่ `/dev/ttyUSB0` หรือ `/dev/ttyACM0`
- [ ] Activate `.venv` แล้ว
- [ ] Pi Unlock Service ทำงาน
- [ ] `curl localhost:5000/health` ผ่าน
- [ ] Frontend Vite ทำงาน
- [ ] `.env` ชี้ Backend PC และ Unlock Service บน Pi ถูกต้อง

### Browser และ Hardware

- [ ] เปิด `http://localhost:5173` บน Pi
- [ ] Slots โหลดสำเร็จ
- [ ] Buy Slot 1 → Lock 1 เปิด → Slot 1 `SOLD_OUT`
- [ ] Buy Slot 2 → Lock 2 เปิด → Slot 2 `SOLD_OUT`
- [ ] Buy Slot 3 → Lock 3 เปิด → Slot 3 `SOLD_OUT`
- [ ] ไม่มีคอยล์ร้อนผิดปกติ กลิ่นไหม้ เสียงหึ่ง หรือกลไกค้าง

## 17. ปิดระบบหลังทดสอบ

หยุด Backend, Pi Unlock Service และ Frontend ใน Terminal ของแต่ละ process ด้วย:

```text
Ctrl+C
```

ปิด PostgreSQL จาก project root บน PC:

```bash
cd /c/smart-vending
docker compose down
```

Deactivate Python environment บน Pi:

```bash
deactivate
```
