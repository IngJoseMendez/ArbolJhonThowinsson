// Autorización en el servidor. Toda consulta de personas pasa por scopeSql()
// y toda modificación por los can*() correspondientes.
import { pathUpper } from './db.js';
import { forbidden } from './util.js';

export const ROLES = {
  super_admin: 'Administrador general',
  head_admin: 'Administrador de cabeza',
  leader: 'Líder',
  member: 'Persona registrada',
};

export const isAdmin = (u) => u && (u.role === 'super_admin' || u.role === 'head_admin');

/** Cabezas visibles por el usuario: null = todas. */
export function visibleHeadIds(u) {
  if (u.role === 'super_admin') return null;
  if (u.role === 'head_admin') return u.headIds;
  return u.person ? [u.person.head_id] : [];
}

export function canManageHead(u, headId) {
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  return u.role === 'head_admin' && u.headIds.includes(Number(headId));
}

export function canViewHead(u, headId) {
  const ids = visibleHeadIds(u);
  return ids === null || ids.includes(Number(headId));
}

/**
 * Fragmento SQL que restringe la tabla `people` (alias) al alcance del usuario.
 *  - super_admin: todo.
 *  - head_admin: personas de sus cabezas.
 *  - leader: su rama de invitación + personas que tiene asignadas como responsable.
 *  - member: su propia rama de invitación.
 */
export function scopeSql(u, alias = 'p') {
  switch (u.role) {
    case 'super_admin':
      return { sql: '1=1', params: [] };
    case 'head_admin':
      if (!u.headIds.length) return { sql: '0=1', params: [] };
      return { sql: `${alias}.head_id IN (${u.headIds.map(() => '?').join(',')})`, params: [...u.headIds] };
    case 'leader':
      if (!u.person) return { sql: '0=1', params: [] };
      return {
        sql: `((${alias}.path >= ? AND ${alias}.path < ?) OR ${alias}.leader_id = ?)`,
        params: [u.person.path, pathUpper(u.person.path), u.person.id],
      };
    case 'member':
      if (!u.person) return { sql: '0=1', params: [] };
      return { sql: `(${alias}.path >= ? AND ${alias}.path < ?)`, params: [u.person.path, pathUpper(u.person.path)] };
    default:
      return { sql: '0=1', params: [] };
  }
}

export function canViewPerson(u, p) {
  if (!u || !p) return false;
  switch (u.role) {
    case 'super_admin': return true;
    case 'head_admin': return u.headIds.includes(p.head_id);
    case 'leader': return !!u.person && (p.path.startsWith(u.person.path) || p.leader_id === u.person.id);
    case 'member': return !!u.person && p.path.startsWith(u.person.path);
    default: return false;
  }
}

/** ¿Puede ver datos de contacto completos? */
export function canSeeContact(u, p) {
  if (!canViewPerson(u, p)) return false;
  if (u.role === 'member') return u.person && u.person.id === p.id;
  return true;
}

export function canManagePerson(u, p) {
  return !!p && canManageHead(u, p.head_id);
}

export function assert(cond, msg) {
  if (!cond) throw forbidden(msg);
}
