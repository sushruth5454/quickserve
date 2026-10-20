import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSession, onAuthChange, type AuthSession } from './api';

export type ActiveRole = 'customer' | 'provider';

interface AuthState {
  session: AuthSession | null;
  userId: string | null;
  loading: boolean;
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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosingRole, setChoosingRole] = useState(false);
  const [activeRole, setRole] = useState<ActiveRole>('customer');

  useEffect(() => {
    let mounted = true;
    Promise.all([getSession(), AsyncStorage.getItem(ROLE_KEY).catch(() => null)]).then(([s, role]) => {
      if (!mounted) return;
      setSession(s);
      if (role === 'provider' || role === 'customer') setRole(role);
      setLoading(false);
    });
    const unsubscribe = onAuthChange((next) => setSession(next));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const setActiveRole = useCallback((r: ActiveRole) => {
    setRole(r);
    void AsyncStorage.setItem(ROLE_KEY, r).catch(() => undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      userId: session?.userId ?? null,
      loading,
      choosingRole,
      setChoosingRole,
      activeRole,
      setActiveRole,
    }),
    [session, loading, choosingRole, activeRole, setActiveRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
