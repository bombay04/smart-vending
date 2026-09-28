import { useEffect, useState } from "react";
import StaffPortal from "./components/StaffPortal";
import HomePage from "./pages/HomePage";
import "./App.css";

const STAFF_PORTAL_PATH = "/staff";

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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

  if (pathname === STAFF_PORTAL_PATH) {
    return (
      <StaffPortal
        onBack={() => {
          window.history.replaceState(null, "", "/");
          setPathname("/");
        }}
      />
    );
  }

  return <HomePage />;
}

export default App;
