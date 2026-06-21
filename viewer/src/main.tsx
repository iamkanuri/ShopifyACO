import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfigProvider } from "./config";
import "./theme.css";
import "./app/app.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
