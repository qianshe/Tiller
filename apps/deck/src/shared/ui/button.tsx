import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/shared/utils/cn";

const buttonVariants = cva(
  // base (no border per Luminous Void "No-Line Rule"; focus uses ring-only)
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 135° gradient CTA (DESIGN.md "Signature Texture")
        default:
          "bg-gradient-to-br from-primary to-primary-strong text-on-primary shadow-ambient hover:opacity-90",
        // glassmorphic secondary (DESIGN.md Glass Rule, lighter version for buttons)
        secondary:
          "bg-surface-emphasis text-foreground hover:bg-surface-emphasis/80",
        // ghost: no background, primary text
        ghost:
          "text-primary hover:bg-primary-soft hover:text-primary",
        // outline: ghost border (per spec §7 mapping)
        outline:
          "border border-border-ghost bg-transparent text-foreground hover:bg-surface-emphasis",
        // destructive
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        // link
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-md px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
