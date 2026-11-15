import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNum(n: number | null | undefined, digits = 4) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e6)) return n.toExponential(2);
  return Number(n.toPrecision(digits)).toString();
}

export function titleCase(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
