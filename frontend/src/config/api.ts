const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, "");
