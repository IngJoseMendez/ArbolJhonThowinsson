import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Tipos de registro (Cabeza, Líder, Persona y los personalizados), con su color. Caché compartida. */
let cache = null;
const listeners = new Set();

export function loadRegTypes(force = false) {
  if (!cache || force) {
    cache = api.get('/reg-types?all=1').catch((e) => { cache = null; throw e; });
    cache.then((list) => listeners.forEach((fn) => fn(list))).catch(() => {});
  }
  return cache;
}
export const clearRegTypes = () => { cache = null; };

export function useRegTypes() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    const fn = (l) => alive && setList(l);
    listeners.add(fn);
    loadRegTypes().then(fn).catch(() => {});
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  return { list, byId, reload: () => loadRegTypes(true) };
}

export const ROLE_LABEL = { head: 'Cabeza', leader: 'Líder', person: 'Persona' };
export const ROLE_HELP = {
  head: 'Quien se registra crea una nueva cabeza (estructura) y queda como su primer líder.',
  leader: 'Quien se registra queda como líder oficial, con su enlace para invitar y su panel de gestión.',
  person: 'Quien se registra queda como persona invitada por quien usted indique.',
};

/** Texto legible (blanco o casi negro) sobre un color de fondo. */
export function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? '#111827' : '#ffffff';
}

/** Variables CSS para teñir una página o tarjeta con el color del tipo. */
export const typeVars = (color) => (color ? { '--type': color, '--type-ink': inkFor(color), '--type-soft': `${color}1f` } : undefined);

export const SWATCHES = ['#2563eb', '#7c3aed', '#d97706', '#16a34a', '#0ea5e9', '#be123c', '#db2777', '#0f766e', '#ea580c', '#4b5563'];
