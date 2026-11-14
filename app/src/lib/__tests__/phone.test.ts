import { formatPhone } from '../phone';

describe('formatPhone', () => {
  it('formats the E.164 number and the "+"-less form Supabase returns for user.phone', () => {
    expect(formatPhone('+919999999999')).toBe('+91 99999 99999');
    expect(formatPhone('919999999999')).toBe('+91 99999 99999');
  });

  it('leaves unrecognised input unchanged', () => {
    expect(formatPhone('12345')).toBe('12345');
    expect(formatPhone(null)).toBe('');
  });
});
