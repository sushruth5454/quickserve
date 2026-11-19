import { authErrorMessage, formatOtpCountdown } from '../authErrors';

describe('authErrorMessage', () => {
  it('uses plain copy for invalid and expired verification codes', () => {
    const message = 'That code is wrong or expired. Check the SMS or tap Resend code.';
    expect(authErrorMessage(new Error('Invalid OTP'))).toBe(message);
    expect(authErrorMessage(new Error('Token expired'))).toBe(message);
  });

  it('uses plain copy for SMS throttling errors', () => {
    const message = 'Please wait a minute before asking for another code.';
    expect(authErrorMessage(new Error('rate limit exceeded'))).toBe(message);
    expect(authErrorMessage(new Error('For security purposes, try again later'))).toBe(message);
    expect(authErrorMessage(new Error('after 60 seconds'))).toBe(message);
  });

  it('hides unknown provider errors behind generic copy', () => {
    expect(authErrorMessage(new Error('Internal provider response'))).toBe('Something went wrong. Try again.');
  });
});

describe('formatOtpCountdown', () => {
  it('formats the configured one-minute resend delay as 1:00', () => {
    expect(formatOtpCountdown(60)).toBe('1:00');
    expect(formatOtpCountdown(30)).toBe('0:30');
  });
});
