# Local voice assets

Install the four production Thai voice prompts in this directory as PCM WAV
files with these exact names:

- `payment_success.wav`
- `unlock_failed.wav`
- `employee_auth_success.wav`
- `restock_complete.wav`

Binary recordings are intentionally not generated or committed by Task 39.
Without a required file, `POST /audio/play` returns HTTP `503`. On the
Raspberry Pi, the service plays these files through ALSA's `aplay` command.
