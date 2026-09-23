import { useEffect, useState } from "react";
import EmployeeFaceRegistration from "./components/EmployeeFaceRegistration";
import StaffPortal from "./components/StaffPortal";
import HomePage from "./pages/HomePage";
import "./App.css";

const ADMIN_FACE_REGISTRATION_PATH = "/admin/face-registration";
const STAFF_PORTAL_PATH = "/staff";

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (pathname === ADMIN_FACE_REGISTRATION_PATH) {
    return (
      <EmployeeFaceRegistration
        onCancel={() => {
          window.history.replaceState(null, "", "/");
          setPathname("/");
        }}
      />
    );
  }

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
