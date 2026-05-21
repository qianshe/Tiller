import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/shared/utils/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // Workbench Void §5.3 — 24px height, 13px text, 8px horizontal padding.
        "flex h-[var(--control-h-md)] w-full rounded-md border border-border-ghost bg-surface-sunken px-[var(--control-px-md)] text-section text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
