import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { AuthProvider } from "@/Context/AuthContext.tsx";
import { CustomerProvider } from "./Context/CustomerContext.tsx";

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <CustomerProvider>
      <App />
    </CustomerProvider>
  </AuthProvider>
);
