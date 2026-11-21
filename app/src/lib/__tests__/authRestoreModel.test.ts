import type { AuthSession } from '../apiTypes';
import {
  initialAuthRestoreState,
  reduceAuthRestoreState,
  type AuthRestoreState,
} from '../authRestoreModel';

const firstSession: AuthSession = { userId: 'user-first', phone: '+10000000001' };
const latestSession: AuthSession = { userId: 'user-latest', phone: '+10000000002' };

function start(generation: number, state: AuthRestoreState = initialAuthRestoreState) {
  return reduceAuthRestoreState(state, { type: 'restore-started', generation });
}

describe('auth restore state', () => {
  it('distinguishes rejection from known signed-out and permits retry', () => {
    const error = new Error('network unavailable');
    const rejected = reduceAuthRestoreState(start(1), {
      type: 'restore-rejected',
      generation: 1,
      error,
    });

    expect(rejected).toMatchObject({ status: 'error', session: null, error });

    const retry = start(2, rejected);
    const knownNull = reduceAuthRestoreState(retry, {
      type: 'restore-resolved',
      generation: 2,
      session: null,
    });
    expect(retry.status).toBe('pending');
    expect(knownNull).toMatchObject({ status: 'known-null', session: null, error: null });
  });

  it('keeps a legitimate null session distinct from a transport error', () => {
    const knownNull = reduceAuthRestoreState(start(1), {
      type: 'restore-resolved',
      generation: 1,
      session: null,
    });

    expect(knownNull).toEqual({
      status: 'known-null',
      generation: 1,
      session: null,
      error: null,
    });
  });

  it('does not let a stale initial session overwrite a later sign-out event', () => {
    const pending = start(1);
    const signedOut = reduceAuthRestoreState(pending, {
      type: 'auth-event',
      generation: 2,
      session: null,
    });
    const staleInitial = reduceAuthRestoreState(signedOut, {
      type: 'restore-resolved',
      generation: 1,
      session: firstSession,
    });

    expect(staleInitial).toBe(signedOut);
    expect(staleInitial.status).toBe('known-null');
  });

  it('lets the latest auth event settle restore and outrank an older initial promise', () => {
    const pending = start(1);
    const signedOut = reduceAuthRestoreState(pending, {
      type: 'auth-event',
      generation: 2,
      session: null,
    });
    const signedIn = reduceAuthRestoreState(signedOut, {
      type: 'auth-event',
      generation: 3,
      session: latestSession,
    });
    const staleInitial = reduceAuthRestoreState(signedIn, {
      type: 'restore-resolved',
      generation: 1,
      session: firstSession,
    });

    expect(signedIn).toMatchObject({ status: 'session', session: latestSession });
    expect(staleInitial).toBe(signedIn);
  });
});
