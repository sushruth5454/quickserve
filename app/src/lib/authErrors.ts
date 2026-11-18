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
