type ClassValue = string | number | null | false | undefined;

/** Minimal className joiner — filters falsy values and joins with spaces. */
export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ');
}
