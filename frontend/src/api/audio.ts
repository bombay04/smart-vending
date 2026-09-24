import { PI_UNLOCK_BASE_URL } from "../config/api";
import type { AudioEvent } from "../audio-feedback.mjs";

const audioPlayUrl = `${PI_UNLOCK_BASE_URL}/audio/play`;

export async function playAudioFeedback(event: AudioEvent): Promise<void> {
  const response = await fetch(audioPlayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event }),
  });

  if (!response.ok) {
    throw new Error("Local audio feedback is unavailable.");
  }
}
