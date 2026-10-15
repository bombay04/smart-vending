# Task 55 — firmware and hardware source of truth

## Scope and evidence level

This is a source-code inspection of [`firmware/vending_esp32.ino`](../firmware/vending_esp32.ino), the Pi service, its serial client, and related repository documentation on branch `feat/task55-firmware-source-of-truth`. The sketch was added to Git as part of Task 55 and is now tracked. Its inspected LF-normalized SHA-256 is `E92918A611E790DAB9D8ACAE56F3375D0F4984BA220735F924E43A5F465770AC`. The project owner confirms personally developing and flashing the ESP32 firmware with Codex assistance. That is owner confirmation, not independent binary verification: the exact match between this repository sketch and the last flashed version remains unverified. The mappings and behaviors below describe the inspected file, not a verified build or a confirmed image running on the cabinet. No ESP32 or Raspberry Pi hardware was connected for this review. A comment in the sketch says the reed polarity came from a hardware test; that historical comment is not an independently confirmed observation in Task 55.

## GPIO map in the inspected sketch

All three arrays use zero-based index `slot number - 1`. These are ESP32 GPIO numbers from the source, not a wiring audit. See the [pin arrays](../firmware/vending_esp32.ino#L47), [polarity settings](../firmware/vending_esp32.ino#L80), and [initialization](../firmware/vending_esp32.ino#L194).

| Physical slot | Relay output for solenoid | Reed switch input for lid | IR product sensor input |
| --- | ---: | ---: | ---: |
| 1 | GPIO 13 | GPIO 32 | GPIO 34 |
| 2 | GPIO 14 | GPIO 33 | GPIO 35 |
| 3 | GPIO 27 | GPIO 25 | GPIO 36 |

- The relay module is configured **active LOW**. Setup writes HIGH before and after changing each relay pin to `OUTPUT`, aiming to leave all relays off at startup. `OPEN:n` writes the selected pin LOW, then the timeout writes it HIGH. This describes the programmed output; relay contact position and actual solenoid motion are not sensed by this code. [Setup](../firmware/vending_esp32.ino#L194), [open](../firmware/vending_esp32.ino#L307), [timeout](../firmware/vending_esp32.ino#L400).
- Reed pins use `INPUT_PULLUP`. `REED_ACTIVE_LOW = true`: a LOW read is reported as `DOOR:n:CLOSED`; HIGH is `DOOR:n:OPEN`. The sketch's comment associates a nearby magnet with LOW and a closed lid. [Pin definitions](../firmware/vending_esp32.ino#L55), [read function](../firmware/vending_esp32.ino#L164).
- IR pins use plain `INPUT`; the sketch notes GPIO 34–36 have no internal pull-up. `IR_ACTIVE_LOW = true`: LOW becomes `IR:n:PRESENT`, HIGH becomes `IR:n:EMPTY`. External sensor output conditioning/bias and voltage compatibility are not specified by this source. [Pin definitions](../firmware/vending_esp32.ino#L70), [read function](../firmware/vending_esp32.ino#L179), [pin mode](../firmware/vending_esp32.ino#L217).
- The code samples both sensor types on boot to initialize its change-detection cache, then prints `READY`. `GET_STATUS` reads GPIO again rather than relying only on that cache. [Boot sequence](../firmware/vending_esp32.ino#L229), [status function](../firmware/vending_esp32.ino#L507).

## USB Serial protocol actually implemented

The sketch calls `Serial.begin(115200)`. The Pi client defaults to **115200 baud** and a **1.0 second read timeout**, with an environment override `ESP32_BAUD_RATE`; `ESP32_SERIAL_PORT` must be set in real-hardware mode. The Pi writes UTF-8 commands followed by LF (`\n`) and flushes. The sketch accumulates bytes until LF, discards CR, trims surrounding whitespace, and ignores an empty command. Replies use `Serial.println`, hence line-terminated text. [Firmware serial setup](../firmware/vending_esp32.ino#L229), [command reader](../firmware/vending_esp32.ino#L272), [client transport](../edge/serial_client.py#L12), [service startup](../edge/pi_unlock_service.py#L997).

| Pi → ESP32 command | Firmware action | ESP32 → Pi response |
| --- | --- | --- |
| `PING` | Liveness request | `PONG` |
| `GET_STATUS` | Read reed and IR GPIO for each slot | Six lines, in slot order: `DOOR:n:OPEN` or `DOOR:n:CLOSED`, then `IR:n:PRESENT` or `IR:n:EMPTY`, for `n = 1, 2, 3`. No `LOCK` line or completion marker is emitted by this command. |
| `OPEN:1`, `OPEN:2`, `OPEN:3` | If no relay is active, drive that slot's relay LOW | `ACK:OPEN:n`, immediately followed by `LOCK:n:OPENED`; after the programmed pulse, `LOCK:n:CLOSED`. |
| `OPEN:` with a parsed slot outside 1–3 | No relay action | `ERROR:INVALID_SLOT` |
| Valid `OPEN:n` while a relay is active | No second relay action | `ERROR:BUSY` |
| Any other nonempty command | No relay action | `ERROR:UNKNOWN_COMMAND` |

At boot, the ESP32 emits `READY` after initialization. Door and IR **change events** can be emitted at any time by the main loop in the same `DOOR:n:...` and `IR:n:...` formats. The firmware implements no request ID or reply correlation. [Command handler](../firmware/vending_esp32.ino#L307), [relay timeout](../firmware/vending_esp32.ino#L400), [sensor events](../firmware/vending_esp32.ino#L428), [full status](../firmware/vending_esp32.ino#L507).

The `OPEN:` parser uses Arduino `String.toInt()` on the suffix, then checks only whether the resulting number is 1–3. Thus the code does not enforce a canonical `OPEN:n` spelling; the Pi client itself emits only validated slot numbers 1–3. Exact handling of malformed numeric suffixes should not be relied upon as a protocol guarantee. [Firmware parser](../firmware/vending_esp32.ino#L313), [Pi slot validation](../edge/serial_client.py#L70).

## Timing and hardware behavior in source

- The relay pulse target is **700 ms** (`UNLOCK_DURATION_MS`), after which the selected relay returns HIGH. `relayActive` blocks any other `OPEN` while that pulse is active. The timeout runs from the main loop, so this is a software timing target, not a measured physical pulse width. [Timing constant](../firmware/vending_esp32.ino#L93), [interlock](../firmware/vending_esp32.ino#L329), [loop](../firmware/vending_esp32.ino#L261), [timeout](../firmware/vending_esp32.ino#L400).
- `LOCK:n:OPENED` is sent after the relay is driven LOW; `LOCK:n:CLOSED` is sent after it returns HIGH. They report the relay control cycle. They do **not** prove the lid moved or the physical lock engaged. `DOOR:n:...` is the separate reed reading. [Open response](../firmware/vending_esp32.ino#L342), [timeout response](../firmware/vending_esp32.ino#L408), [project terminology](project-spec.md#L63).
- Sensor change events use separate 150 ms intervals for reed and IR per slot. A changed read is emitted when more than 150 ms has elapsed since that sensor's last accepted change; the code does not require the new level to remain stable for a full 150 ms. `GET_STATUS` reports current reads immediately and synchronizes the cached values. [Debounce constant](../firmware/vending_esp32.ino#L100), [change detection](../firmware/vending_esp32.ino#L433), [status sampling](../firmware/vending_esp32.ino#L507).

## Pi-side behavior and comparison

- `Esp32SerialClient.open_slot()` validates an integer slot 1–3, sends `OPEN:n\n`, and returns after the serial write/flush. It does not read `ACK:OPEN:n`, `ERROR:BUSY`, or `LOCK:n:...`. The `/unlock` HTTP endpoint then returns `UNLOCK_COMMAND_SENT` and stores a process-local transaction outcome for duplicate suppression. That HTTP success confirms a write, **not** firmware acceptance, relay actuation, or a physical unlock. [Client](../edge/serial_client.py#L57), [service unlock](../edge/pi_unlock_service.py#L746).
- `/hardware/status` clears the serial input buffer, writes `GET_STATUS`, and waits up to **3 seconds** for one `DOOR` and one `IR` line for every slot. It maps these to `doorClosed` and `productPresent`. It ignores `READY`, `PONG`, `ACK`, `LOCK`, errors, and malformed/unrelated lines; incomplete status returns HTTP 503. The operation uses a serial lock shared with the unlock write. [Status collector](../edge/pi_unlock_service.py#L286), [HTTP route](../edge/pi_unlock_service.py#L336).
- The client's parser recognizes `ACK`, `LOCK`, `DOOR`, `IR`, and `ERROR` formats and classifies `READY` and `PONG`. In the service, parsed `LOCK` and `ACK` lines are not used to confirm unlocks. The interactive serial CLI can display them, and its `--self-test` exercises parser examples without opening a port. [Parser](../edge/serial_client.py#L104), [CLI](../edge/serial_test.py#L104).
- `MOCK_HARDWARE=true` bypasses Serial: `/hardware/status` reports all slots present and closed, and `/unlock` returns a simulated success. Those values are fixtures, not observations. [Mock route](../edge/pi_unlock_service.py#L336), [mock unlock](../edge/pi_unlock_service.py#L814).

### Findings and current status

1. **RESOLVED — protocol documentation.** The earlier [`docs/serial-protocol.md`](serial-protocol.md) incorrectly said `GET_STATUS` requested lock, door, and IR status, and omitted `PONG`. The corrected document now specifies the firmware's six `DOOR`/`IR` lines for Slots 1–3, no `LOCK` line in that response, the Pi collector's matching expectations, and `PING` → `PONG`. It also distinguishes relay-cycle `LOCK` messages from reed-switch door state. This resolves the documentation mismatch; it does not verify deployed hardware.
2. **RESOLVED — serial CLI guide.** The earlier [`docs/full-system-test-guide.md`](full-system-test-guide.md) said the CLI classified `PONG` as `UNKNOWN`. The corrected example and note now show `PONG` classified as `PONG`, consistent with [`classify_message()`](../edge/serial_client.py#L104) and the [`--self-test` case](../edge/serial_test.py#L103).
3. **OPEN — unlock response is not confirmed.** Firmware can reject an `OPEN` with `ERROR:BUSY` or `ERROR:INVALID_SLOT`, but Pi `/unlock` does not wait for or match an ESP32 `ACK`/`ERROR` response. A successful HTTP response can coexist with a firmware rejection or no observed firmware response. `LOCK` messages are not consumed by a continuous listener in the service. [Firmware errors](../firmware/vending_esp32.ino#L313), [Pi unlock](../edge/pi_unlock_service.py#L836).
4. **OPEN — no request/response or snapshot correlation.** The Serial protocol has no request ID or response correlation, and `GET_STATUS` has no snapshot/completion marker. The Pi collector relies on six valid sensor lines after its buffer clear and request; unsolicited sensor change lines share those formats. Source review alone cannot establish timing or physical consistency under a live serial stream. [Firmware status](../firmware/vending_esp32.ino#L507), [Pi collector](../edge/pi_unlock_service.py#L286).
5. **OPEN — relay state is not physical lid state.** The firmware has no electrical feedback for relay output or solenoid/lock position. `LOCK:n:OPENED` and `LOCK:n:CLOSED` indicate the programmed relay cycle, not observed lid movement or closure; `DOOR:n:...` is the separate reed reading. [Relay messages](../firmware/vending_esp32.ino#L342), [reed messages](../firmware/vending_esp32.ino#L433).
6. **OPEN — flashed version unverified.** The owner confirms developing and flashing firmware, but Task 55 has not independently established that the current sketch exactly matches the last flashed ESP32 binary or verified its physical behavior.

## Physical verification still required

On the actual cabinet, an authorized hardware test must confirm the deployed ESP32 is running this exact sketch/version; each GPIO-to-relay/reed/IR wire and slot label; active-LOW relay behavior and safe startup/reset state; reed magnet polarity and lid semantics; IR output polarity, electrical level, and stable bias on input-only GPIO 34–36; the 700 ms pulse and solenoid return; one-at-a-time interlock; and the Pi's actual serial device/baud and observed command/reply sequence. None of those were independently measured for Task 55. The source comment about an earlier reed hardware test is useful context but is not a current measurement.

## Non-hardware validation

- `python edge/serial_test.py --self-test` with `PYTHONDONTWRITEBYTECODE=1`: **passed**, all 10 parser/classifier cases, including `PONG`, `ACK`, `LOCK`, `DOOR`, `IR`, and `ERROR:BUSY`.
- `python -m unittest edge.tests.test_pi_unlock_service` with `PYTHONDONTWRITEBYTECODE=1`: **not runnable in this local interpreter**. Import fails before tests execute with `ModuleNotFoundError: No module named 'flask'`. This does not indicate a failing service assertion.
- No serial port, firmware flash, or physical actuator/sensor test was run.
