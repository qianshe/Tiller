import React from "react";
import { createRoot } from "react-dom/client";
import { ToastViewport } from "../../features/toast";
import { AppErrorBoundary } from "./error-boundary";
import { App } from "./root";
import "./tokens.css";
import "./styles.css";
import "../../features/mission/styles.css";
import "../../features/agents/styles.css";
import "../../features/prompt-enhancer/styles.css";
import "../../features/pairing/styles.css";
import "../../features/settings/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ToastViewport />
  </React.StrictMode>,
);
