import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/shared/utils/cn";

const badgeVariants = cva(
  // pill shape, no border per Luminous Void
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary",
        secondary: "bg-surface-emphasis text-foreground",
        success: "bg-success-container text-on-success-container",
        warning: "bg-warning text-on-warning",
        destructive: "bg-destructive text-white",
        outline: "border border-border-ghost text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";

export { badgeVariants };
