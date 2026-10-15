import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { clearTreeCaches } from './lib/treeStore.js';
import { clearCache } from './lib/cache.js';
import { forgetTabs } from './lib/nav.js';

/** Al salir (o vencer la sesión) no queda nada de la sesión en memoria ni en la pestaña. */
const forgetSession = () => { clearTreeCaches(); clearCache(); forgetTabs(); };

const AuthCtx = createContext(null);

// La consulta de la sesión puede empezar antes de montar la app (en paralelo con la descarga de las pantallas).
let early = null;
export function preloadSession() { early ??= api.get('/session').catch(() => null); }

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null });
  const refresh = useCallback(async () => {
    try { setState({ loading: false, me: await api.get('/session') }); } catch { setState({ loading: false, me: null }); }
  }, []);
  const first = useCallback(async () => {
    if (!early) return refresh();
    const p = early;
    early = null;
    setState({ loading: false, me: await p });
  }, [refresh]);
  useEffect(() => {
    first();
    const onExpired = () => { forgetSession(); setState({ loading: false, me: null }); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [first]);
  const logout = async () => { await api.post('/auth/logout'); forgetSession(); setState({ loading: false, me: null }); };
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
    // Fotos de las personas de confianza (el servidor tiene Cloudinary configurado).
    photos: !!c.me?.features?.photos,
  };
}
