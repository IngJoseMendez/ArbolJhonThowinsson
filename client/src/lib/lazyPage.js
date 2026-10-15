import { lazy } from 'react';

const KEY = 'chunk-reload-at';

/**
 * Tras publicar una versión nueva, una pestaña abierta con la anterior puede pedir archivos que ya no existen.
 * En ese caso se recarga la página una sola vez (no en bucle) para traer la versión publicada.
 */
export function reloadOnce() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 15000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sin almacenamiento: se recarga igual */ }
  window.location.reload();
  return true;
}

/** Pantalla que se descarga cuando se abre (React.lazy) y se recupera sola si cambió la versión publicada. */
export const lazyPage = (factory) => lazy(() => factory().catch((e) => {
  if (reloadOnce()) return new Promise(() => {});
  throw e;
}));
