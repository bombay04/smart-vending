const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const configuredPiUnlockBaseUrl =
  import.meta.env.VITE_PI_UNLOCK_BASE_URL?.trim() || "http://localhost:5000";

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");
export const PI_UNLOCK_BASE_URL = configuredPiUnlockBaseUrl.replace(/\/+$/, "");
