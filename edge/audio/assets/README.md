# Local voice assets

The repository includes four Thai PCM WAV prompts with these exact names:

- `payment_success.wav`
- `unlock_failed.wav`
- `employee_auth_success.wav`
- `restock_complete.wav`

Task 39 intentionally did not fabricate recordings; the tracked assets were
provided by later work. On the Raspberry Pi, the service plays them through
ALSA's `aplay` command. Event-by-event playback through the cabinet speaker still
requires physical validation. If a required file is absent, `POST /audio/play`
returns HTTP `503`.
