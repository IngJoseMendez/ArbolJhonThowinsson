import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Parámetros de búsqueda como objeto, con actualización parcial (null elimina). Con una hoja abierta (celular) se
 * reemplaza su entrada del historial en lugar de agregar otra.
 */
export function useQueryState() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const set = useCallback((patch, replace = false) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k); else next.set(k, String(v));
      }
      return next;
    }, { replace: replace || !!window.history.state?.mSheet });
  }, [setSp]);
  return [params, set];
}
