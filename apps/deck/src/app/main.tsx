import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./root";
import { ToastViewport } from "../features/toast/store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ToastViewport />
  </React.StrictMode>,
);
