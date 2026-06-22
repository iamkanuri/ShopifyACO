import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfigProvider } from "./config";
import { initTheme } from "./theme";
import "./theme.css";
import "./app/app.css";

// Reflect a stored light/dark choice before first render (system preference is handled
// in CSS, so visitors who follow their OS see no flash).
initTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
