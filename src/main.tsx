import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import "@fontsource-variable/inter";
import "./styles.css";
import { ServerConnectionGate } from "./components/settings/ServerConnection";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ServerConnectionGate><App /></ServerConnectionGate>
    </ThemeProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && !window.rooms && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
