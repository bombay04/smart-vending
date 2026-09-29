export const CUSTOMER_KIOSK_PATH = "/";
export const STAFF_PORTAL_PATH = "/staff";
export const ADMIN_PORTAL_PATH = "/admin";

export function resolveAppPathname(pathname) {
  if (
    pathname === CUSTOMER_KIOSK_PATH ||
    pathname === STAFF_PORTAL_PATH ||
    pathname === ADMIN_PORTAL_PATH
  ) {
    return pathname;
  }

  return CUSTOMER_KIOSK_PATH;
}
