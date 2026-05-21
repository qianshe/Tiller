import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge, twMerge as defaultTwMerge } from "tailwind-merge";

/**
 * Workbench Void v3 type-scale tokens (see app/shell/tokens.css).
 * Registered as a font-size class group so tailwind-merge stops
 * dropping them when an unrelated text-* utility (text-left,
 * text-foreground, etc.) sits in the same className string.
 */
const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "section", "action", "meta", "default", "2xs"] },
      ],
    },
  },
});

/**
 * Merge classNames with clsx semantics, then deduplicate conflicting Tailwind utilities.
 * Use this for every component className composition in shared/ui and feature ui/.
 */
export function cn(...inputs: ClassValue[]): string {
  return customTwMerge(clsx(inputs));
}

// Keep default twMerge exported for direct callers that bypass our custom config.
export { defaultTwMerge as twMerge };
