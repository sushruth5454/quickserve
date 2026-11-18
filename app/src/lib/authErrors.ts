export function authErrorMessage(e: Error): string {
  const message = e.message ?? '';
  if (/expired|invalid/i.test(message)) {
    return 'That code is wrong or expired. Check the SMS or tap Resend code.';
  }
  if (/rate limit|security purposes|after \d+ seconds/i.test(message)) {
    return 'Please wait a minute before asking for another code.';
  }
  return 'Something went wrong. Try again.';
}

export function formatOtpCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
