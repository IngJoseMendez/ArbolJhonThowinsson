import { useMemo } from 'react';
import { api } from '../api.js';
import { useCached } from './cache.js';

// Cómo se nombra cada equipo: por la persona que es su cabeza; si la estructura aún no tiene cabeza, por su nombre.
// Nunca «Cabeza Juan Pérez» cuando hay una persona al frente.

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** Nombre del equipo: la cabeza (persona) o, sin cabeza, el nombre de la estructura. */
export const teamName = (h) => (h ? h.cabeza_name || h.name || '' : '');

/** «Equipo de Juan Carlos Restrepo Díaz», o el nombre de la estructura si no tiene cabeza. */
export const teamLabel = (h) => (h?.cabeza_name ? `Equipo de ${h.cabeza_name}` : h?.name || '');

/** Nombre corto para fichas: «Juan Carlos» (cuatro palabras o más), «Rafael», o «Centro» para «Cabeza Centro». */
export function shortTeam(h) {
  if (!h) return '';
  if (h.cabeza_name) {
    const w = words(h.cabeza_name);
    return w.length >= 4 ? `${w[0]} ${w[1]}` : w[0];
  }
  return String(h.name || '').replace(/^cabeza\s+/i, '') || h.name;
}

export const firstName = (full) => words(full)[0] || '';

/** Nombre y primer apellido: «Lucía Fernández», «Juan Carlos Restrepo». */
export function shortName(full) {
  const w = words(full);
  if (w.length >= 4) return w.slice(0, 3).join(' ');
  return w.slice(0, 2).join(' ');
}

export const initialsOf = (name = '') => words(name).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

/**
 * Nombres cortos que no se repiten entre los equipos dados: «Rafael»; si otro también se vería «Rafael», «Rafael
 * Noguera»; luego el nombre completo. Si dos cabezas se llaman igual: su región, o desde cuándo están y, si también
 * coinciden, el orden de llegada como sus estructuras («Rafael Noguera (2)»). Devuelve id -> nombre.
 */
export function distinctTeamLabels(list) {
  const brief = (h) => (h.cabeza_name ? shortName(h.cabeza_name) : shortTeam(h));
  const levels = [
    shortTeam,
    brief,
    teamName,
    (h) => (h.region ? `${brief(h)} (${h.region})` : teamName(h)),
    (h) => `${brief(h)} (desde el ${day.format(new Date(h.created_at))})`,
  ];
  const out = new Map();
  const used = new Set();
  const take = (h, label) => { out.set(h.id, label); used.add(label); };
  let todo = list;
  for (const fn of levels) {
    if (!todo.length) break;
    const seen = new Map();
    for (const h of todo) seen.set(fn(h), (seen.get(fn(h)) || 0) + 1);
    todo = todo.filter((h) => {
      if (seen.get(fn(h)) > 1 || used.has(fn(h))) return true;
      take(h, fn(h));
      return false;
    });
  }
  const order = new Map();
  for (const h of [...todo].sort((a, b) => a.id - b.id)) {
    const n = (order.get(teamName(h)) || 0) + 1;
    order.set(teamName(h), n);
    take(h, n === 1 && !used.has(brief(h)) ? brief(h) : `${brief(h)} (${n})`);
  }
  return out;
}

/** Las cabezas visibles (en caché): lista, búsqueda por id y nombres de equipo. */
export function useTeams() {
  const heads = useCached('heads', () => api.get('/heads'), { ttl: 60000 });
  return useMemo(() => {
    const list = heads.data || [];
    const byId = new Map(list.map((h) => [h.id, h]));
    const counts = new Map();
    for (const h of list) counts.set(teamName(h), (counts.get(teamName(h)) || 0) + 1);
    const shorts = distinctTeamLabels(list);
    return {
      ...heads,
      list,
      active: list.filter((h) => h.status === 'active'),
      manageable: list.filter((h) => h.status === 'active' && h.can_manage),
      byId,
      name: (id) => teamName(byId.get(Number(id))),
      label: (id) => teamLabel(byId.get(Number(id))),
      /** Si otro equipo se llama igual: su región o «desde el 14 oct»; si no, vacío. */
      twin: (h) => (counts.get(teamName(h)) > 1 ? (h.region || `desde el ${day.format(new Date(h.created_at))}`) : ''),
      /** Nombre corto para fichas, distinto del de cualquier otro equipo (ver distinctTeamLabels). */
      short: (h) => (h ? shorts.get(h.id) ?? shortTeam(h) : ''),
    };
  }, [heads]);
}
