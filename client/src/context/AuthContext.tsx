import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'agency' | 'mid' | 'mid_gcc' | 'admin';
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<any>;
  register: (fullName: string, email: string, password: string, role?: string) => Promise<any>;
  verifyOtp: (email: string, otp: string) => Promise<any>;
  loginWithGoogle: (email?: string, name?: string) => Promise<any>;
  logout: () => void;
  updateUserRole: (newRole: 'agency' | 'mid' | 'mid_gcc' | 'admin') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('pil_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('pil_token'));
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Session expired');
          return res.json();
        })
        .then(data => {
          setUser(data.user);
          localStorage.setItem('pil_user', JSON.stringify(data.user));
        })
        .catch(() => {
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw data;
    }
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('pil_token', data.token);
    localStorage.setItem('pil_user', JSON.stringify(data.user));
    return data;
  };

  const register = async (fullName: string, email: string, password: string, role: string = 'agency') => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  };

  const verifyOtp = async (email: string, otp: string) => {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('pil_token', data.token);
    localStorage.setItem('pil_user', JSON.stringify(data.user));
    return data;
  };

  const loginWithGoogle = async (email?: string, name?: string) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, full_name: name }),
    });
    const data = await res.json();
    if (!res.ok) throw data;
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('pil_token', data.token);
    localStorage.setItem('pil_user', JSON.stringify(data.user));
    return data;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('pil_token');
    localStorage.removeItem('pil_user');
  };

  const updateUserRole = (newRole: 'agency' | 'mid' | 'mid_gcc' | 'admin') => {
    if (user) {
      const updated = { ...user, role: newRole };
      setUser(updated);
      localStorage.setItem('pil_user', JSON.stringify(updated));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        verifyOtp,
        loginWithGoogle,
        logout,
        updateUserRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
