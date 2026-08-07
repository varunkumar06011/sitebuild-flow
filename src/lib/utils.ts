import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merges Tailwind class names, resolving conflicting utility classes.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
