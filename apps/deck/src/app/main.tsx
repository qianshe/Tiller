import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { ToastViewport } from "../features/toast/toast";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ToastViewport />
  </React.StrictMode>,
);
