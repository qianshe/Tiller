import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/shared/utils/cn";

const buttonVariants = cva(
  // Workbench Void base · DESIGN.md §5.2 / §6.1
  //   - 13px default text (text-[13px], not text-sm=14px)
  //   - icons sized 14px (toolbar density), set via [&_svg]:size-3.5
  //   - no border; pane boundaries use ring-1 in §6.1, not border-1
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Flat primary · DESIGN.md §3.4 — gradient moved to hero only
        default:
          "bg-primary text-on-primary hover:bg-primary-strong",
        // Signature gradient · DESIGN.md §3.4 — 135° brand blue, max 1 per screen
        hero:
          "bg-gradient-to-br from-primary to-primary-strong text-on-primary shadow-ambient hover:opacity-90",
        // Glassmorphic secondary · DESIGN.md §6.4 glass rule, lighter for buttons
        secondary:
          "bg-surface-emphasis text-foreground hover:bg-surface-emphasis/80",
        // Ghost · no background, primary text · IDE toolbar default
        ghost:
          "text-foreground hover:bg-surface-emphasis hover:text-foreground",
        // Outline · ring-based per DESIGN.md §6.1 (no 1px solid border)
        outline:
          "ring-1 ring-border-ghost/40 bg-transparent text-foreground hover:bg-surface-emphasis",
        // Destructive
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        // Link · text-only affordance
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 24px · IDE default · DESIGN.md §5.1
        default: "h-[var(--control-h-md)] px-[var(--control-px-md)]",
        // 22px · toolbar / tab strip / status bar
        sm: "h-[var(--control-h-sm)] rounded px-[var(--control-px-sm)] text-xs",
        // 20px · compact · inline row actions, dense panels
        xs: "h-[var(--control-h-xs)] rounded px-[var(--control-px-xs)] text-xs",
        // 32px · hero · landing CTA / empty-state primary
        lg: "h-[var(--control-h-lg)] rounded-md px-[var(--control-px-lg)] text-sm",
        // Icon · 24x24 default density
        icon: "h-[var(--control-h-md)] w-[var(--control-h-md)]",
        // Icon · 22x22 toolbar
        "icon-sm": "h-[var(--control-h-sm)] w-[var(--control-h-sm)] [&_svg]:size-3.5",
        // Icon · 20x20 compact
        "icon-xs": "h-[var(--control-h-xs)] w-[var(--control-h-xs)] [&_svg]:size-3",
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
