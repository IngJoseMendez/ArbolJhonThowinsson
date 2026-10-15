import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Caché en memoria de esta pestaña: al volver a una pantalla se ve al instante lo último cargado y se actualiza en
// segundo plano. Nada se guarda en el dispositivo; al cerrar sesión se borra.
const store = new Map(); // clave -> { data, error, at, promise, fetcher }
const subs = new Map(); // clave -> Set(fn)
const emit = (key) => subs.get(key)?.forEach((fn) => fn());

function revalidate(key, fetcher) {
  const e = store.get(key) || {};
  if (e.promise) return e.promise;
  const promise = Promise.resolve().then(fetcher)
    .then((data) => { store.set(key, { data, error: null, at: Date.now(), promise: null, fetcher }); emit(key); return data; })
    .catch((error) => { store.set(key, { ...store.get(key), error, at: Date.now(), promise: null, fetcher }); emit(key); throw error; });
  store.set(key, { ...e, promise, fetcher });
  emit(key);
  return promise;
}

/** Pide (o reutiliza) los datos de una clave fuera de React, por ejemplo para precargar. */
export function preload(key, fetcher, ttl = 30000) {
  const e = store.get(key);
  if (e && (e.promise || Date.now() - e.at <= ttl)) return e.promise || Promise.resolve(e.data);
  return revalidate(key, fetcher).catch(() => {});
}

/**
 * Datos de `fetcher` guardados bajo `key` (null: no cargar). Vuelve a pedirlos si tienen más de `ttl` ms.
 * Devuelve { data, error, loading, refreshing, reload, mutate }.
 */
export function useCached(key, fetcher, { ttl = 30000 } = {}) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const subscribe = useCallback((cb) => {
    if (key == null) return () => {};
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(cb);
    return () => subs.get(key)?.delete(cb);
  }, [key]);
  const snapshot = useCallback(() => (key == null ? undefined : store.get(key)), [key]);
  const e = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (key == null) return;
    const cur = store.get(key);
    if (!cur || (!cur.promise && Date.now() - cur.at > ttl)) revalidate(key, () => fetcherRef.current()).catch(() => {});
  }, [key, ttl]);
  const reload = useCallback(() => (key == null ? Promise.resolve() : revalidate(key, () => fetcherRef.current()).catch(() => {})), [key]);
  const mutate = useCallback((fn) => {
    if (key == null) return;
    const cur = store.get(key) || {};
    store.set(key, { ...cur, data: typeof fn === 'function' ? fn(cur.data) : fn, at: cur.at || Date.now() });
    emit(key);
  }, [key]);
  return {
    data: e?.data,
    error: e?.data === undefined ? e?.error ?? null : null,
    loading: key != null && e?.data === undefined && !e?.error,
    refreshing: !!e?.promise,
    reload,
    mutate,
  };
}

/**
 * Los datos cuyas claves empiezan por `prefix` quedan viejos: los que están a la vista se vuelven a pedir ya, el resto
 * cuando se abra su pantalla.
 */
export function invalidate(prefix = '') {
  for (const [key, e] of store) {
    if (!key.startsWith(prefix)) continue;
    if (subs.get(key)?.size && e.fetcher) revalidate(key, e.fetcher).catch(() => {});
    else store.set(key, { ...e, at: 0 });
  }
}

// Otras memorias de la sesión (listas cargadas, invitaciones preparadas) se registran aquí y se borran con la caché.
const clearers = new Set();
export const onClear = (fn) => { clearers.add(fn); };

export function clearCache() { store.clear(); clearers.forEach((fn) => fn()); }
