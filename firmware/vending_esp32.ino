/*
  Smart Vending Cabinet - ESP32 Firmware
  --------------------------------------

  หน้าที่:
  1. อ่านสถานะ Reed Switch (ฝากล่อง) x3
  2. อ่านสถานะ IR Sensor (มี/ไม่มีสินค้า) x3
  3. รับคำสั่งปลดล็อกผ่าน Relay จาก Raspberry Pi (USB Serial)
  4. มีระบบ Interlock กันปลดล็อกเกิน 1 ช่องพร้อมกัน

  Board: ESP32 Dev Module (ESP-32S)
  Baud Rate: 115200

  Serial Protocol

  Pi -> ESP32
  PING
  OPEN:1
  OPEN:2
  OPEN:3
  GET_STATUS

  ESP32 -> Pi
  READY
  PONG
  ACK:OPEN:1
  ACK:OPEN:2
  ACK:OPEN:3
  LOCK:1:OPENED
  LOCK:1:CLOSED

  IR:1:PRESENT
  IR:1:EMPTY

  DOOR:1:OPEN
  DOOR:1:CLOSED

  ERROR:INVALID_SLOT
  ERROR:UNKNOWN_COMMAND
  ERROR:BUSY
*/


// ============================================================
// Pin Definitions
// ============================================================

// Relay module เป็น Active LOW
const int RELAY_PIN[3] = {
  13,
  14,
  27
};

// Reed switch ใช้ INPUT_PULLUP
//
// จาก Hardware Test จริง:
// Magnet อยู่ใกล้ sensor -> GPIO LOW
// Magnet อยู่ใกล้ = ฝากล่องปิด
//
// ดังนั้น:
// LOW  = CLOSED
// HIGH = OPEN
const int REED_PIN[3] = {
  32,
  33,
  25
};

// IR Sensor
// GPIO34-36 เป็น input-only และไม่มี internal pull-up
const int IR_PIN[3] = {
  34,
  35,
  36
};


// ============================================================
// Sensor Logic Configuration
// ============================================================

// Reed:
// true หมายถึง LOW = Magnet detected = Door CLOSED
const bool REED_ACTIVE_LOW = true;

// IR:
// true หมายถึง LOW = มีสินค้า / Object detected
const bool IR_ACTIVE_LOW = true;


// ============================================================
// Timing Configuration
// ============================================================

// ระยะเวลาจ่ายไฟให้ Solenoid
//
// เดิมเคยเป็น 4000 ms ซึ่งนานเกินไปและเสี่ยงคอยล์ร้อน
// 700 ms เพียงพอสำหรับ prototype ปัจจุบัน
const unsigned long UNLOCK_DURATION_MS = 700;

// Debounce sensor
const unsigned long DEBOUNCE_MS = 150;


// ============================================================
// Sensor State
// ============================================================

bool lastReedClosed[3] = {
  false,
  false,
  false
};

bool lastIrPresent[3] = {
  false,
  false,
  false
};


// แยก debounce timer ระหว่าง Reed และ IR
// เพื่อไม่ให้ sensor คนละชนิดรบกวนกัน
unsigned long lastReedDebounceTime[3] = {
  0,
  0,
  0
};

unsigned long lastIrDebounceTime[3] = {
  0,
  0,
  0
};


// ============================================================
// Relay / Interlock State
// ============================================================

bool relayActive = false;

int activeSlot = -1;

unsigned long relayStartTime = 0;


// ============================================================
// Serial State
// ============================================================

String inputBuffer = "";


// ============================================================
// Helper Functions
// ============================================================

// อ่าน Reed แล้วคืนค่า semantic ที่ระบบต้องการ
//
// true  = Door CLOSED
// false = Door OPEN
bool readReedClosed(int index) {
  bool raw = digitalRead(REED_PIN[index]);

  if (REED_ACTIVE_LOW) {
    return raw == LOW;
  }

  return raw == HIGH;
}


// อ่าน IR แล้วคืนค่า semantic ที่ระบบต้องการ
//
// true  = Product PRESENT
// false = Product EMPTY
bool readIrPresent(int index) {
  bool raw = digitalRead(IR_PIN[index]);

  if (IR_ACTIVE_LOW) {
    return raw == LOW;
  }

  return raw == HIGH;
}


// ============================================================
// Setup
// ============================================================

void setup() {

  // ----------------------------------------------------------
  // Relay initialization
  // ----------------------------------------------------------
  //
  // Relay เป็น Active LOW
  //
  // เราตั้ง output latch เป็น HIGH ก่อนเปลี่ยน pin เป็น OUTPUT
  // เพื่อลดโอกาส relay เด้งตอน ESP32 boot/reset
  //
  for (int i = 0; i < 3; i++) {

    digitalWrite(RELAY_PIN[i], HIGH);

    pinMode(RELAY_PIN[i], OUTPUT);

    digitalWrite(RELAY_PIN[i], HIGH);
  }


  // ----------------------------------------------------------
  // Sensor initialization
  // ----------------------------------------------------------

  for (int i = 0; i < 3; i++) {

    pinMode(REED_PIN[i], INPUT_PULLUP);

    // GPIO34, 35, 36 ไม่มี internal pull-up
    pinMode(IR_PIN[i], INPUT);
  }


  // ----------------------------------------------------------
  // Serial initialization
  // ----------------------------------------------------------

  Serial.begin(115200);

  delay(200);


  // ----------------------------------------------------------
  // อ่าน sensor จริงตอน boot
  // ----------------------------------------------------------
  //
  // ห้าม initialize เป็นค่าปลอม เช่น CLOSED/PRESENT ทุกช่อง
  //
  // เพราะ GET_STATUS ต้องสะท้อน hardware จริง
  //
  for (int i = 0; i < 3; i++) {

    lastReedClosed[i] = readReedClosed(i);

    lastIrPresent[i] = readIrPresent(i);
  }


  Serial.println("READY");
}


// ============================================================
// Main Loop
// ============================================================

void loop() {

  readSerialCommand();

  checkSensors();

  checkRelayTimeout();
}


// ============================================================
// Serial Command Reader
// ============================================================

void readSerialCommand() {

  while (Serial.available()) {

    char c = Serial.read();


    if (c == '\n') {

      inputBuffer.trim();


      if (inputBuffer.length() > 0) {

        handleCommand(inputBuffer);
      }


      inputBuffer = "";

    } else if (c != '\r') {

      inputBuffer += c;
    }
  }
}


// ============================================================
// Command Handler
// ============================================================

void handleCommand(String cmd) {

  // ----------------------------------------------------------
  // OPEN:x
  // ----------------------------------------------------------

  if (cmd.startsWith("OPEN:")) {

    int slot = cmd.substring(5).toInt();

    int idx = slot - 1;


    // Slot ต้องเป็น 1-3
    if (idx < 0 || idx > 2) {

      Serial.println("ERROR:INVALID_SLOT");

      return;
    }


    // --------------------------------------------------------
    // Hardware Interlock
    // --------------------------------------------------------
    //
    // ห้ามเปิด solenoid มากกว่า 1 ช่องพร้อมกัน
    //
    if (relayActive) {

      Serial.println("ERROR:BUSY");

      return;
    }


    // Relay เป็น Active LOW
    digitalWrite(RELAY_PIN[idx], LOW);


    relayActive = true;

    activeSlot = idx;

    relayStartTime = millis();


    Serial.println(
      "ACK:OPEN:" + String(slot)
    );


    Serial.println(
      "LOCK:" + String(slot) + ":OPENED"
    );
  }


  // ----------------------------------------------------------
  // GET_STATUS
  // ----------------------------------------------------------

  else if (cmd == "GET_STATUS") {

    sendFullStatus();
  }


  // ----------------------------------------------------------
  // PING
  // ----------------------------------------------------------

  else if (cmd == "PING") {

    Serial.println("PONG");
  }


  // ----------------------------------------------------------
  // Unknown command
  // ----------------------------------------------------------

  else {

    Serial.println("ERROR:UNKNOWN_COMMAND");
  }
}


// ============================================================
// Relay Timeout
// ============================================================

void checkRelayTimeout() {

  if (
    relayActive &&
    millis() - relayStartTime >= UNLOCK_DURATION_MS
  ) {

    // Relay Active LOW
    // HIGH = ปิด relay / หยุดจ่ายไฟให้ solenoid
    digitalWrite(
      RELAY_PIN[activeSlot],
      HIGH
    );


    Serial.println(
      "LOCK:" +
      String(activeSlot + 1) +
      ":CLOSED"
    );


    relayActive = false;

    activeSlot = -1;
  }
}


// ============================================================
// Sensor Change Detection
// ============================================================

void checkSensors() {

  unsigned long now = millis();


  for (int i = 0; i < 3; i++) {


    // ========================================================
    // Reed Switch
    // ========================================================

    bool reedClosedNow =
      readReedClosed(i);


    if (
      reedClosedNow != lastReedClosed[i] &&
      now - lastReedDebounceTime[i] > DEBOUNCE_MS
    ) {

      lastReedClosed[i] =
        reedClosedNow;


      lastReedDebounceTime[i] =
        now;


      Serial.println(
        "DOOR:" +
        String(i + 1) +
        ":" +
        (reedClosedNow ? "CLOSED" : "OPEN")
      );
    }


    // ========================================================
    // IR Sensor
    // ========================================================

    bool irPresentNow =
      readIrPresent(i);


    if (
      irPresentNow != lastIrPresent[i] &&
      now - lastIrDebounceTime[i] > DEBOUNCE_MS
    ) {

      lastIrPresent[i] =
        irPresentNow;


      lastIrDebounceTime[i] =
        now;


      Serial.println(
        "IR:" +
        String(i + 1) +
        ":" +
        (irPresentNow ? "PRESENT" : "EMPTY")
      );
    }
  }
}


// ============================================================
// GET_STATUS
// ============================================================

void sendFullStatus() {

  for (int i = 0; i < 3; i++) {


    // --------------------------------------------------------
    // อ่าน GPIO จริงทุกครั้ง
    // --------------------------------------------------------
    //
    // ไม่ใช้ cached state อย่างเดียว
    //
    // GET_STATUS ต้องหมายถึง:
    // "สถานะ hardware ตอนนี้"
    //
    bool reedClosedNow =
      readReedClosed(i);


    bool irPresentNow =
      readIrPresent(i);


    // Sync cache กับค่าปัจจุบัน
    lastReedClosed[i] =
      reedClosedNow;


    lastIrPresent[i] =
      irPresentNow;


    // --------------------------------------------------------
    // Door
    // --------------------------------------------------------

    Serial.println(
      "DOOR:" +
      String(i + 1) +
      ":" +
      (reedClosedNow ? "CLOSED" : "OPEN")
    );


    // --------------------------------------------------------
    // IR
    // --------------------------------------------------------

    Serial.println(
      "IR:" +
      String(i + 1) +
      ":" +
      (irPresentNow ? "PRESENT" : "EMPTY")
    );
  }
}