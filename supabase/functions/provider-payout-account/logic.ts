import { ACCOUNT_RE, IFSC_RE, PAN_RE, type BeneficiaryInput, type RailName } from "../_shared/payout-rail.ts";

export interface SubmitBody {
  account_type?: unknown;
  legal_name?: unknown;
  pan?: unknown;
  gstin?: unknown;
  email?: unknown;
  account_number?: unknown;
  confirm_account_number?: unknown;
  ifsc?: unknown;
  address?: { street?: unknown; city?: unknown; state?: unknown; postal_code?: unknown } | null;
}

export type FieldErrors = Partial<Record<"account_type" | "legal_name" | "pan" | "gstin" | "email" | "account_number" | "confirm_account_number" | "ifsc" | "address", string>>;

const BUSINESS_PAN_RE = /^[A-Z]{3}[CFHATBLJG][A-Z][0-9]{4}[A-Z]$/;
const GSTIN_RE = /^(0[1-9]|[12][0-9]|3[0-8]|97)([A-Z]{5}[0-9]{4}[A-Z])[1-9A-Z]Z[0-9A-Z]$/;

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

export function canSubmitBusinessPayoutAccount(isProvider: boolean, hasVerifiedVenue: boolean, features: unknown): boolean {
  if (!features || typeof features !== "object") return false;
  const flags = features as Record<string, unknown>;
  if (flags.business_payout_identity !== true) return false;
  if (isProvider) return true;
  return hasVerifiedVenue && flags.sports === true && flags.sports_online_payments === true;
}

/** Validates the payout form. Address is required only on the Route rail (linked-account registered address). */
export function parseSubmit(
  body: SubmitBody,
  ctx: { providerId: string; phone: string; rail: RailName },
): { ok: true; input: BeneficiaryInput & { accountType: "individual" | "business"; gstin: string | null } } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const rawAccountType = str(body.account_type) || "individual";
  const accountType = rawAccountType === "business" ? "business" : "individual";
  const legalName = str(body.legal_name).replace(/\s+/g, " ");
  const pan = str(body.pan).toUpperCase();
  const gstin = str(body.gstin).toUpperCase();
  const email = str(body.email).toLowerCase();
  const accountNumber = str(body.account_number).replace(/\s+/g, "");
  const confirm = str(body.confirm_account_number).replace(/\s+/g, "");
  const ifsc = str(body.ifsc).toUpperCase();

  if (rawAccountType !== "individual" && rawAccountType !== "business") {
    errors.account_type = "Choose an account type.";
  }
  if (accountType === "business") {
    if (!/^[A-Za-z0-9][A-Za-z0-9 &.,'()/-]{2,99}$/.test(legalName)) {
      errors.legal_name = "Enter the registered business name.";
    }
    if (!BUSINESS_PAN_RE.test(pan)) errors.pan = "Enter a valid business PAN.";
    if (gstin && (!GSTIN_RE.test(gstin) || gstin.slice(2, 12) !== pan)) {
      errors.gstin = "Check this GSTIN and PAN combination.";
    }
  } else if (accountType === "individual") {
    if (!/^[A-Za-z][A-Za-z .'-]{3,79}$/.test(legalName)) {
      errors.legal_name = "Enter your full name exactly as on your PAN card (at least 4 letters).";
    }
    if (!PAN_RE.test(pan)) errors.pan = "Enter a valid individual PAN, e.g. ABCPE1234F (4th letter is P).";
    if (gstin) errors.gstin = "GSTIN is available for business accounts only.";
  }
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
      accountType,
      legalName,
      pan,
      gstin: gstin || null,
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
