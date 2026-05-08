import { useSyncExternalStore } from "react";
import { toast, type ToastVariant } from "./store";

if (typeof document !== "undefined") {
  void import("./styles.css");
}

const toastLabels: Record<ToastVariant, string> = {
  success: "成功",
  error: "错误",
  warning: "警告",
  info: "提示",
};

export function ToastViewport() {
  const items = useSyncExternalStore(
    (onStoreChange) => toast.subscribe(() => onStoreChange()),
    toast.getSnapshot,
    toast.getSnapshot,
  );

  return (
    <div className="toast-viewport" aria-label="通知">
      {items.map((item) => (
        <article
          key={item.id}
          className={`toast-item toast-${item.variant} toast-${item.state}`}
          role={item.variant === "error" ? "alert" : "status"}
          aria-live={item.variant === "error" ? "assertive" : "polite"}
        >
          <div className="toast-content">
            <span className="toast-label">{toastLabels[item.variant]}</span>
            <p>{item.message}</p>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label={`关闭通知：${item.message}`}
            onClick={() => toast.dismiss(item.id)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  );
}
