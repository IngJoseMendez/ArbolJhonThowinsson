import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null });
  const refresh = useCallback(async () => {
    try { setState({ loading: false, me: await api.get('/me') }); } catch { setState({ loading: false, me: null }); }
  }, []);
  useEffect(() => {
    refresh();
    const onExpired = () => setState({ loading: false, me: null });
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh]);
  const logout = async () => { await api.post('/auth/logout'); setState({ loading: false, me: null }); };
  return <AuthCtx.Provider value={{ ...state, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  const role = c.me?.user.role;
  return {
    ...c,
    user: c.me?.user,
    person: c.me?.person,
    isSuper: role === 'super_admin',
    isAdmin: role === 'super_admin' || role === 'head_admin',
    canManageHead: (id) => role === 'super_admin' || (role === 'head_admin' && c.me.user.head_ids.includes(Number(id))),
  };
}
