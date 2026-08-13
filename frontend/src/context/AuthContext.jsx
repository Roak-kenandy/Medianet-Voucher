import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, setAccessToken, clearAccessToken, refreshAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const bootstrap = useCallback(async () => {
    try {
      setLoading(true);
      try {
        await refreshAccessToken();
      } catch {
        clearAccessToken();
        setUser(null);
        return;
      }
      const data = await authApi.me();
      setUser(data.user);
    } catch {
      clearAccessToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = async ({ email, password }) => {
    setError(null);
    const data = await authApi.login({ email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      clearAccessToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, setError, login, logout, bootstrap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
