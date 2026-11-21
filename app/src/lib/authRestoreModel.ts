import type { AuthSession } from './apiTypes';

export type AuthRestoreState =
  | { status: 'pending'; generation: number; session: null; error: null }
  | { status: 'error'; generation: number; session: null; error: unknown }
  | { status: 'known-null'; generation: number; session: null; error: null }
  | { status: 'session'; generation: number; session: AuthSession; error: null };

export type AuthRestoreAction =
  | { type: 'restore-started'; generation: number }
  | { type: 'restore-resolved'; generation: number; session: AuthSession | null }
  | { type: 'restore-rejected'; generation: number; error: unknown }
  | { type: 'auth-event'; generation: number; session: AuthSession | null };

export const initialAuthRestoreState: AuthRestoreState = {
  status: 'pending',
  generation: 0,
  session: null,
  error: null,
};

export function reduceAuthRestoreState(
  state: AuthRestoreState,
  action: AuthRestoreAction,
): AuthRestoreState {
  if (action.type === 'restore-started') {
    if (action.generation <= state.generation) return state;
    return {
      status: 'pending',
      generation: action.generation,
      session: null,
      error: null,
    };
  }

  if (action.type === 'auth-event') {
    if (action.generation <= state.generation) return state;
    return action.session
      ? {
          status: 'session',
          generation: action.generation,
          session: action.session,
          error: null,
        }
      : {
          status: 'known-null',
          generation: action.generation,
          session: null,
          error: null,
        };
  }

  if (state.status !== 'pending' || action.generation !== state.generation) return state;

  if (action.type === 'restore-rejected') {
    return {
      status: 'error',
      generation: action.generation,
      session: null,
      error: action.error,
    };
  }

  return action.session
    ? {
        status: 'session',
        generation: action.generation,
        session: action.session,
        error: null,
      }
    : {
        status: 'known-null',
        generation: action.generation,
        session: null,
        error: null,
      };
}
