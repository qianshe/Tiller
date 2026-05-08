import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge classNames with clsx semantics, then deduplicate conflicting Tailwind utilities.
 * Use this for every component className composition in shared/ui and feature ui/.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
