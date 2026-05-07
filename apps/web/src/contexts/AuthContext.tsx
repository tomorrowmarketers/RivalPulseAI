'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface User {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (payload: { email: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  async function refreshSession() {
    try {
      const response = await api.getMe();
      setUser(response.user);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }

  useEffect(() => {
    refreshSession();
  }, []);

  async function login(payload: { email: string; password: string }): Promise<User> {
    const response = await api.login(payload);
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setStatus('anonymous');
  }

  return (
    <AuthContext.Provider value={{ user, status, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
