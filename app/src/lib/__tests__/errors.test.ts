import { friendlyError } from '../errors';

describe('friendlyError', () => {
  it('maps network errors and preserves the raw message', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toEqual({
      key: 'error.network',
      raw: 'Failed to fetch',
    });
  });

  it('maps authentication errors and preserves the raw message', () => {
    expect(friendlyError(new Error('JWT expired'))).toEqual({
      key: 'error.signIn',
      raw: 'JWT expired',
    });
  });

  it('maps rate-limit errors and preserves the raw message', () => {
    expect(friendlyError(new Error('429 rate limit exceeded'))).toEqual({
      key: 'ai.busy',
      raw: '429 rate limit exceeded',
    });
  });

  it('maps all other errors to the generic key and preserves the raw message', () => {
    expect(friendlyError(new Error('Unexpected response'))).toEqual({
      key: 'error.generic',
      raw: 'Unexpected response',
    });
  });
});
