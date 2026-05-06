import React from "react";
import { createRoot } from "react-dom/client";
import { ToastViewport } from "../../features/toast";
import { AppErrorBoundary } from "./error-boundary";
import { App } from "./root";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ToastViewport />
  </React.StrictMode>,
);
