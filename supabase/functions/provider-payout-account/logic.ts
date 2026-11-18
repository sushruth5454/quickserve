import { ACCOUNT_RE, IFSC_RE, PAN_RE, type BeneficiaryInput, type RailName } from "../_shared/payout-rail.ts";

export interface SubmitBody {
  legal_name?: unknown;
  pan?: unknown;
  email?: unknown;
  account_number?: unknown;
  confirm_account_number?: unknown;
  ifsc?: unknown;
  address?: { street?: unknown; city?: unknown; state?: unknown; postal_code?: unknown } | null;
}

export type FieldErrors = Partial<Record<"legal_name" | "pan" | "email" | "account_number" | "confirm_account_number" | "ifsc" | "address", string>>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function canManagePayoutAccount(isProvider: boolean, hasVerifiedVenue: boolean): boolean {
  return isProvider || hasVerifiedVenue;
}

export function canSubmitPayoutAccount(isProvider: boolean, hasVerifiedVenue: boolean, features: unknown): boolean {
  if (isProvider) return true;
  if (!hasVerifiedVenue || !features || typeof features !== "object") return false;
  const flags = features as Record<string, unknown>;
  return flags.sports === true && flags.sports_online_payments === true;
}

/** Validates the payout form. Address is required only on the Route rail (linked-account registered address). */
export function parseSubmit(
  body: SubmitBody,
  ctx: { providerId: string; phone: string; rail: RailName },
): { ok: true; input: BeneficiaryInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const legalName = str(body.legal_name).replace(/\s+/g, " ");
  const pan = str(body.pan).toUpperCase();
  const email = str(body.email).toLowerCase();
  const accountNumber = str(body.account_number).replace(/\s+/g, "");
  const confirm = str(body.confirm_account_number).replace(/\s+/g, "");
  const ifsc = str(body.ifsc).toUpperCase();

  if (!/^[A-Za-z][A-Za-z .'-]{3,79}$/.test(legalName)) {
    errors.legal_name = "Enter your full name exactly as on your PAN card (at least 4 letters).";
  }
  if (!PAN_RE.test(pan)) errors.pan = "Enter a valid individual PAN, e.g. ABCPE1234F (4th letter is P).";
  if (!/^[^\s@]{1,64}@[^\s@]{1,68}\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address.";
  if (!ACCOUNT_RE.test(accountNumber)) errors.account_number = "Enter your bank account number (9 to 18 digits).";
  else if (confirm !== accountNumber) errors.confirm_account_number = "Account numbers do not match.";
  if (!IFSC_RE.test(ifsc)) errors.ifsc = "Enter a valid 11-character IFSC, e.g. HDFC0001234.";

  let address: BeneficiaryInput["address"];
  if (ctx.rail === "route") {
    const a = body.address ?? {};
    const street = str(a.street);
    const city = str(a.city);
    const state = str(a.state);
    const postalCode = str(a.postal_code);
    if (street.length < 10 || city.length < 2 || state.length < 2 || !/^[1-9][0-9]{5}$/.test(postalCode)) {
      errors.address = "Enter your full address (street of at least 10 characters, city, state and 6-digit PIN code).";
    } else {
      address = { street, city, state, postalCode };
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      providerId: ctx.providerId,
      legalName,
      pan,
      email,
      phone: ctx.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""),
      accountNumber,
      ifsc,
      address,
    },
  };
}

/** Last 4 digits only; the full account number is never stored. */
export function maskAccount(accountNumber: string): string {
  return accountNumber.slice(-4);
}

/** Provider-facing copy for gateway problems (never the raw gateway text, which can echo inputs). */
export function friendlyGatewayError(field: string | null, description: string): string {
  const d = description.toLowerCase();
  if (field?.includes("ifsc") || d.includes("ifsc")) return "This IFSC was not recognised. Check it on your cheque book or bank app.";
  if (field?.includes("pan") || d.includes("pan")) return "This PAN could not be accepted. Check it and try again.";
  if (field?.includes("email") || d.includes("email")) return "This email could not be accepted. Use another email address.";
  if (d.includes("account")) return "These bank details could not be accepted. Check the account number and IFSC.";
  return "We could not save your payout details. Please check them and try again.";
}
