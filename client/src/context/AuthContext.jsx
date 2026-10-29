// client/src/context/AuthContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('iot_token');
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(r => setUser(r.data.data || r.data))
      .catch(() => localStorage.removeItem('iot_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await authApi.login({ email, password });
    const { token, user: u } = r.data.data || r.data;
    localStorage.setItem('iot_token', token);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const r = await authApi.register({ name, email, password });
    const { token, user: u } = r.data.data || r.data;
    localStorage.setItem('iot_token', token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('iot_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
