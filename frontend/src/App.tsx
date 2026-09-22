import { useEffect, useState } from "react";
import EmployeeFaceRegistration from "./components/EmployeeFaceRegistration";
import HomePage from "./pages/HomePage";
import "./App.css";

const ADMIN_FACE_REGISTRATION_PATH = "/admin/face-registration";

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

  return <HomePage />;
}

export default App;
