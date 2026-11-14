/** Client-side validation for onboarding forms. The server re-validates everything. */
import { BIO_MAX, BIO_MIN } from './copy';
import type { PayoutFieldErrors, PayoutForm } from './types';

export const PAN_RE = /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^[0-9]{9,18}$/;

export interface BasicsErrors {
  fullName?: string;
  photo?: string;
  bio?: string;
  languages?: string;
}

export function validateBasics(v: { fullName: string; hasPhoto: boolean; bio: string; languages: string[] }): BasicsErrors {
  const e: BasicsErrors = {};
  const name = v.fullName.trim();
  if (name.length < 2 || name.length > 60) e.fullName = 'Enter your name (2 to 60 characters).';
  if (!v.hasPhoto) e.photo = 'Add a profile photo with your face clearly visible.';
  const bio = v.bio.trim();
  if (bio.length < BIO_MIN) e.bio = `Write at least ${BIO_MIN} characters (${Math.max(0, BIO_MIN - bio.length)} more).`;
  else if (bio.length > BIO_MAX) e.bio = `Keep it under ${BIO_MAX} characters.`;
  if (/(\+?91[\s-]?)?[6-9]\d{9}/.test(bio.replace(/\s/g, ''))) e.bio = 'Do not put phone numbers in your bio. Customers contact you through the app.';
  if (v.languages.length === 0) e.languages = 'Pick at least one language.';
  return e;
}

/** "199", "199.50", "₹1,299" → paise; null when empty or invalid. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function validateFees(visitFeeText: string, labourText: string): { visitFee?: string; labourRate?: string } {
  const e: { visitFee?: string; labourRate?: string } = {};
  const v = parseRupees(visitFeeText);
  const l = parseRupees(labourText);
  if (v == null) e.visitFee = 'Enter your visit fee in rupees.';
  else if (v > 200000) e.visitFee = 'Visit fee looks too high (max ₹2,000).';
  if (l == null) e.labourRate = 'Enter your labour rate in rupees.';
  else if (l <= 0) e.labourRate = 'Labour rate must be more than ₹0.';
  else if (l > 5000000) e.labourRate = 'Labour rate looks too high (max ₹50,000).';
  return e;
}

export function validatePayoutForm(f: PayoutForm, rail: 'route' | 'payouts'): PayoutFieldErrors {
  const e: PayoutFieldErrors = {};
  const name = f.legal_name.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z][A-Za-z .'-]{3,79}$/.test(name)) e.legal_name = 'Enter your full name exactly as on your PAN card.';
  if (!PAN_RE.test(f.pan.trim().toUpperCase())) e.pan = 'Enter a valid individual PAN, e.g. ABCPE1234F (4th letter is P).';
  if (!/^[^\s@]{1,64}@[^\s@]{1,68}\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  const acc = f.account_number.replace(/\s+/g, '');
  if (!ACCOUNT_RE.test(acc)) e.account_number = 'Enter your bank account number (9 to 18 digits).';
  else if (f.confirm_account_number.replace(/\s+/g, '') !== acc) e.confirm_account_number = 'Account numbers do not match.';
  if (!IFSC_RE.test(f.ifsc.trim().toUpperCase())) e.ifsc = 'Enter a valid 11-character IFSC, e.g. HDFC0001234.';
  if (rail === 'route') {
    const a = f.address;
    if (!a || a.street.trim().length < 10 || a.city.trim().length < 2 || a.state.trim().length < 2 || !/^[1-9][0-9]{5}$/.test(a.postal_code.trim())) {
      e.address = 'Enter your full address with a 6-digit PIN code.';
    }
  }
  return e;
}

/** Documents and photos: allowed types and limits match the storage buckets (migration 0009). */
export const LIMITS = {
  avatarBytes: 2 * 1024 * 1024,
  portfolioBytes: 5 * 1024 * 1024,
  documentBytes: 10 * 1024 * 1024,
  portfolioMax: 12,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  documentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
};

export function checkUpload(kind: 'avatar' | 'portfolio' | 'document', mimeType: string, bytes: number | null | undefined): string | null {
  const types = kind === 'document' ? LIMITS.documentTypes : LIMITS.imageTypes;
  if (!types.includes(mimeType)) return kind === 'document' ? 'Upload a JPG, PNG or PDF.' : 'Upload a JPG, PNG or WebP photo.';
  const max = kind === 'avatar' ? LIMITS.avatarBytes : kind === 'portfolio' ? LIMITS.portfolioBytes : LIMITS.documentBytes;
  if (bytes != null && bytes > max) return `File is too large (max ${Math.round(max / 1024 / 1024)} MB).`;
  return null;
}
