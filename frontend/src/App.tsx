import { useEffect, useState } from "react";
import AdminPortal from "./components/AdminPortal";
import StaffPortal from "./components/StaffPortal";
import HomePage from "./pages/HomePage";
import {
  ADMIN_PORTAL_PATH,
  CUSTOMER_KIOSK_PATH,
  resolveAppPathname,
  STAFF_PORTAL_PATH,
} from "./app-route.mjs";
import "./App.css";

function App() {
  const [pathname, setPathname] = useState(() =>
    resolveAppPathname(window.location.pathname),
  );

  useEffect(() => {
    const syncPathname = () => {
      const resolvedPathname = resolveAppPathname(window.location.pathname);
      if (resolvedPathname !== window.location.pathname) {
        window.history.replaceState(null, "", resolvedPathname);
      }
      setPathname(resolvedPathname);
    };
    syncPathname();
    window.addEventListener("popstate", syncPathname);
    return () => window.removeEventListener("popstate", syncPathname);
  }, []);

  const returnToCustomerKiosk = () => {
    window.history.replaceState(null, "", CUSTOMER_KIOSK_PATH);
    setPathname(CUSTOMER_KIOSK_PATH);
  };

  useEffect(() => {
    const preventKioskContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("contextmenu", preventKioskContextMenu);
    return () =>
      document.removeEventListener("contextmenu", preventKioskContextMenu);
  }, []);

  if (pathname === CUSTOMER_KIOSK_PATH) {
    return <HomePage />;
  }

  if (pathname === STAFF_PORTAL_PATH) {
    return <StaffPortal onBack={returnToCustomerKiosk} />;
  }

  if (pathname === ADMIN_PORTAL_PATH) {
    return <AdminPortal onBack={returnToCustomerKiosk} />;
  }

  return null;
}

export default App;
