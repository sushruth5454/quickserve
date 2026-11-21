import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { getSession, onAuthChange, type AuthSession } from './api';
import {
  initialAuthRestoreState,
  reduceAuthRestoreState,
} from './authRestoreModel';

export type ActiveRole = 'customer' | 'provider';

interface AuthState {
  session: AuthSession | null;
  userId: string | null;
  loading: boolean;
  restoreStatus: 'pending' | 'error' | 'known-null' | 'session';
  restoreError: unknown | null;
  retryRestore: () => Promise<void>;
  /** True between OTP verification and the role-selection step of a fresh login. */
  choosingRole: boolean;
  setChoosingRole: (v: boolean) => void;
  /** Which tab set the user is in; remembered across launches. */
  activeRole: ActiveRole;
  setActiveRole: (r: ActiveRole) => void;
}

const ROLE_KEY = 'quickserve.activeRole';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [restoreState, dispatchRestore] = useReducer(
    reduceAuthRestoreState,
    initialAuthRestoreState,
  );
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const [choosingRole, setChoosingRole] = useState(false);
  const [activeRole, setRole] = useState<ActiveRole>('customer');

  const restoreSession = useCallback(async () => {
    const generation = ++generationRef.current;
    dispatchRestore({ type: 'restore-started', generation });

    void AsyncStorage.getItem(ROLE_KEY)
      .then((role) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (role === 'provider' || role === 'customer') setRole(role);
      })
      .catch(() => undefined);

    try {
      const session = await getSession();
      if (!mountedRef.current || generation !== generationRef.current) return;
      dispatchRestore({ type: 'restore-resolved', generation, session });
    } catch (error) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      dispatchRestore({ type: 'restore-rejected', generation, error });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const eventsBeforeSubscribe = generationRef.current;
    const unsubscribe = onAuthChange((next) => {
      const generation = ++generationRef.current;
      dispatchRestore({ type: 'auth-event', generation, session: next });
      if (!next) {
        // Signed out: the next login starts fresh on the customer side.
        setChoosingRole(false);
        setRole('customer');
        void AsyncStorage.removeItem(ROLE_KEY).catch(() => undefined);
      }
    });
    if (generationRef.current === eventsBeforeSubscribe) void restoreSession();

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      unsubscribe();
    };
  }, [restoreSession]);

  const setActiveRole = useCallback((r: ActiveRole) => {
    setRole(r);
    void AsyncStorage.setItem(ROLE_KEY, r).catch(() => undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session: restoreState.session,
      userId: restoreState.session?.userId ?? null,
      loading: restoreState.status === 'pending',
      restoreStatus: restoreState.status,
      restoreError: restoreState.status === 'error' ? restoreState.error : null,
      retryRestore: restoreSession,
      choosingRole,
      setChoosingRole,
      activeRole,
      setActiveRole,
    }),
    [restoreState, restoreSession, choosingRole, activeRole, setActiveRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
