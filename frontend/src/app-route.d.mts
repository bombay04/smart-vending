export type AppPathname = "/" | "/staff" | "/admin";

export const CUSTOMER_KIOSK_PATH: "/";
export const STAFF_PORTAL_PATH: "/staff";
export const ADMIN_PORTAL_PATH: "/admin";

export function resolveAppPathname(pathname: string): AppPathname;
