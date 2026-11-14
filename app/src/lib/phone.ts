/** "98765 43210" / "+91 98765-43210" / "919876543210" → "+919876543210"; null if not a valid Indian mobile. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

/** "+919876543210" or "919876543210" (Supabase stores phones without "+") → "+91 98765 43210". */
export function formatPhone(phone: string | undefined | null): string {
  if (!phone) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(normalizeIndianPhone(phone) ?? '');
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}
