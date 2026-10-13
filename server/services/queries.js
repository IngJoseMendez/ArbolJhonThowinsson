// Consultas de lectura: nodos del árbol, búsqueda, directorio y estadísticas.
import { q, getDb, pathUpper } from '../db.js';
import { scopeSql, canSeeContact, canViewPerson, visibleHeadIds } from '../permissions.js';
import { normalizeText, normalizePhone, maskPhone } from '../util.js';
import { ancestorIds } from './people.js';

export const NODE_SELECT = `
  SELECT p.id, p.code, p.full_name, p.is_leader, p.leader_code, p.status, p.created_at, p.depth, p.inviter_id,
         p.leader_id, p.leader_mode, p.head_id, p.registration_method, p.path, p.city,
         (SELECT COUNT(*) FROM people c WHERE c.inviter_id = p.id AND c.status <> 'rejected') AS child_count,
         (SELECT COUNT(*) FROM people d WHERE d.path > p.path AND d.path < p.path || '~' AND d.status <> 'rejected') AS descendant_count,
         l.full_name AS leader_name, i.full_name AS inviter_name
    FROM people p
    LEFT JOIN people l ON l.id = p.leader_id
    LEFT JOIN people i ON i.id = p.inviter_id`;

const toNode = (r) => ({ ...r, is_leader: !!r.is_leader });

/** Hijos directos (árbol de invitación) con paginación. parentId = null => raíz de la cabeza. */
export function treeChildren(user, headId, parentId, { offset = 0, limit = 100, include = null } = {}) {
  let rows;
  let total;
  if (parentId == null) {
    if (user.role === 'leader' || user.role === 'member') {
      // La raíz visible es la propia persona.
      const me = user.person && user.person.head_id === headId ? q(`${NODE_SELECT} WHERE p.id = ?`).get(user.person.id) : null;
      return { nodes: me ? [toNode(me)] : [], total: me ? 1 : 0, offset: 0 };
    }
    total = q(`SELECT COUNT(*) n FROM people WHERE head_id = ? AND inviter_id IS NULL AND status <> 'rejected'`).get(headId).n;
    rows = q(`${NODE_SELECT} WHERE p.head_id = ? AND p.inviter_id IS NULL AND p.status <> 'rejected'
               ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`).all(headId, limit, offset);
  } else {
    total = q(`SELECT COUNT(*) n FROM people WHERE inviter_id = ? AND status <> 'rejected'`).get(parentId).n;
    rows = q(`${NODE_SELECT} WHERE p.inviter_id = ? AND p.status <> 'rejected'
               ORDER BY p.is_leader DESC, p.created_at, p.id LIMIT ? OFFSET ?`).all(parentId, limit, offset);
  }
  if (include && !rows.some((r) => r.id === include)) {
    const extra = q(`${NODE_SELECT} WHERE p.id = ? AND p.status <> 'rejected'`).get(include);
    if (extra && (extra.inviter_id ?? null) === (parentId ?? null) && extra.head_id === headId) rows.push(extra);
  }
  return { nodes: rows.map(toNode), total, offset };
}

/** Cadena desde la raíz visible hasta la persona (para resaltar camino / localizar). */
export function pathToPerson(user, person) {
  const ids = ancestorIds(person.path);
  const rows = q(`${NODE_SELECT} WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, toNode(r)]));
  let chain = ids.map((id) => byId.get(id));
  if (user.role === 'leader' || user.role === 'member') {
    const idx = chain.findIndex((n) => n.id === user.person?.id);
    chain = idx >= 0 ? chain.slice(idx) : [chain[chain.length - 1]];
  }
  return chain;
}

export function search(user, term, { headId = null, limit = 20 } = {}) {
  const t = String(term ?? '').trim();
  if (t.length < 2) return [];
  const sc = scopeSql(user);
  const conds = [];
  const params = [];
  conds.push('p.name_key LIKE ?'); params.push(`%${normalizeText(t)}%`);
  conds.push('p.code = ?'); params.push(t.toUpperCase());
  conds.push('p.leader_code LIKE ?'); params.push(`%${t.toUpperCase()}%`);
  const digits = normalizePhone(t);
  if (digits.length >= 4 && user.role !== 'member') { conds.push('p.phone LIKE ?'); params.push(`%${digits}%`); }
  let where = `(${conds.join(' OR ')}) AND p.status <> 'rejected' AND ${sc.sql}`;
  const allParams = [...params, ...sc.params];
  if (headId) { where += ' AND p.head_id = ?'; allParams.push(headId); }
  return q(`SELECT p.id, p.code, p.full_name, p.is_leader, p.leader_code, p.status, p.head_id, p.depth, p.phone, p.path,
                   h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, l.full_name AS leader_name
              FROM people p JOIN heads h ON h.id = p.head_id
              LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
             WHERE ${where}
             ORDER BY p.is_leader DESC, p.full_name LIMIT ?`).all(...allParams, limit)
    .map((r) => ({ ...r, is_leader: !!r.is_leader, phone: canSeeContact(user, r) ? r.phone : maskPhone(r.phone), path: undefined }));
}

const SORTS = {
  full_name: 'p.name_key', created_at: 'p.created_at', head: 'h.name', leader: 'l.name_key', inviter: 'i.name_key',
  status: 'p.status', descendants: 'descendant_count',
};

export function directory(user, f) {
  const sc = scopeSql(user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (f.q) {
    const t = String(f.q).trim();
    const digits = normalizePhone(t);
    const ors = ['p.name_key LIKE ?', 'p.code = ?', 'p.leader_code LIKE ?'];
    params.push(`%${normalizeText(t)}%`, t.toUpperCase(), `%${t.toUpperCase()}%`);
    if (digits.length >= 4 && user.role !== 'member') { ors.push('p.phone LIKE ?'); params.push(`%${digits}%`); }
    where.push(`(${ors.join(' OR ')})`);
  }
  if (f.head_id) { where.push('p.head_id = ?'); params.push(Number(f.head_id)); }
  if (f.leader_id) { where.push('p.leader_id = ?'); params.push(Number(f.leader_id)); }
  if (f.inviter_id) { where.push('p.inviter_id = ?'); params.push(Number(f.inviter_id)); }
  if (f.status) { where.push('p.status = ?'); params.push(String(f.status)); } else where.push(`p.status <> 'rejected'`);
  if (f.method) { where.push('p.registration_method = ?'); params.push(String(f.method)); }
  if (f.type === 'leader') where.push('p.is_leader = 1');
  if (f.type === 'person') where.push('p.is_leader = 0');
  if (f.from) { where.push('p.created_at >= ?'); params.push(String(f.from)); }
  if (f.to) { where.push('p.created_at < ?'); params.push(String(f.to) + 'T23:59:59.999Z'); }
  const sortCol = SORTS[f.sort] || 'p.created_at';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(Math.max(Number(f.pageSize) || 25, 5), 200);
  const page = Math.max(Number(f.page) || 1, 1);
  const base = `FROM people p JOIN heads h ON h.id = p.head_id
                LEFT JOIN people l ON l.id = p.leader_id LEFT JOIN people i ON i.id = p.inviter_id
                WHERE ${where.join(' AND ')}`;
  const total = q(`SELECT COUNT(*) n ${base}`).get(...params).n;
  const rows = q(`SELECT p.id, p.code, p.full_name, p.phone, p.email, p.city, p.is_leader, p.leader_code, p.status,
                         p.registration_method, p.created_at, p.head_id, p.path, p.leader_id, p.inviter_id,
                         h.name AS head_name, h.color AS head_color, l.full_name AS leader_name, i.full_name AS inviter_name,
                         (SELECT COUNT(*) FROM people d WHERE d.path > p.path AND d.path < p.path || '~' AND d.status <> 'rejected') AS descendant_count
                  ${base} ORDER BY ${sortCol} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return {
    total, page, pageSize,
    rows: rows.map((r) => {
      const contact = canSeeContact(user, r);
      return { ...r, is_leader: !!r.is_leader, phone: contact ? r.phone : maskPhone(r.phone), email: contact ? r.email : null, path: undefined };
    }),
  };
}

function headFilter(user, alias = 'p') {
  const ids = visibleHeadIds(user);
  if (ids === null) return { sql: '1=1', params: [] };
  if (!ids.length) return { sql: '0=1', params: [] };
  return { sql: `${alias}.head_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Estadísticas del dashboard, siempre calculadas sobre la BD y dentro del alcance del usuario. */
export function dashboard(user, { headId = null, days = 90 } = {}) {
  const sc = scopeSql(user);
  const hf = headFilter(user, 'h');
  const extra = headId ? ' AND p.head_id = ?' : '';
  const ep = headId ? [Number(headId)] : [];
  const w = `${sc.sql}${extra}`;
  const wp = [...sc.params, ...ep];

  const totals = q(`SELECT
      SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN p.status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN p.is_leader = 1 AND p.status <> 'rejected' THEN 1 ELSE 0 END) AS leaders,
      SUM(CASE WHEN p.status <> 'rejected' THEN 1 ELSE 0 END) AS people,
      SUM(CASE WHEN p.registration_method = 'invitation' AND p.status <> 'rejected' THEN 1 ELSE 0 END) AS via_invitation,
      SUM(CASE WHEN p.registration_method = 'manual' AND p.status <> 'rejected' THEN 1 ELSE 0 END) AS via_manual,
      SUM(CASE WHEN p.created_at >= ? AND p.status <> 'rejected' THEN 1 ELSE 0 END) AS last7,
      MAX(p.depth) AS max_depth
    FROM people p WHERE ${w}`).get(new Date(Date.now() - 7 * 864e5).toISOString(), ...wp);
  for (const k of Object.keys(totals)) totals[k] = totals[k] ?? 0;

  const headsCount = q(`SELECT COUNT(*) n FROM heads h WHERE h.status = 'active' AND ${hf.sql}`).get(...hf.params).n;

  const perHead = q(`SELECT h.id, h.name, h.color,
        COUNT(p.id) AS people,
        SUM(CASE WHEN p.is_leader = 1 THEN 1 ELSE 0 END) AS leaders,
        SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM heads h LEFT JOIN people p ON p.head_id = h.id AND p.status <> 'rejected' AND ${sc.sql}
      WHERE h.status = 'active' AND ${hf.sql} ${headId ? 'AND h.id = ?' : ''}
      GROUP BY h.id ORDER BY people DESC, h.name`).all(...sc.params, ...hf.params, ...ep);

  const scl = scopeSql(user, 'l');
  const perLeader = q(`SELECT l.id, l.full_name, l.leader_code, l.head_id, h.name AS head_name, h.color AS head_color,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        (SELECT COUNT(*) FROM people d WHERE d.path > l.path AND d.path < l.path || '~' AND d.status <> 'rejected') AS branch
      FROM people l JOIN heads h ON h.id = l.head_id
      WHERE l.is_leader = 1 AND l.status <> 'rejected' AND ${scl.sql} ${headId ? 'AND l.head_id = ?' : ''}
      ORDER BY assigned DESC, branch DESC LIMIT 12`).all(...scl.params, ...ep);

  const recent = q(`SELECT p.id, p.code, p.full_name, p.is_leader, p.status, p.registration_method, p.created_at,
        h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, i.id AS inviter_id, l.full_name AS leader_name
      FROM people p JOIN heads h ON h.id = p.head_id LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
      WHERE ${w} AND p.status <> 'rejected' ORDER BY p.created_at DESC, p.id DESC LIMIT 12`).all(...wp);

  // Crecimiento: acumulado diario por cabeza en la ventana solicitada.
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const baseRows = q(`SELECT p.head_id, COUNT(*) n FROM people p WHERE ${w} AND p.status <> 'rejected' AND p.created_at < ?
                      GROUP BY p.head_id`).all(...wp, since);
  const daily = q(`SELECT substr(p.created_at, 1, 10) AS day, p.head_id, COUNT(*) n FROM people p
                   WHERE ${w} AND p.status <> 'rejected' AND p.created_at >= ? GROUP BY day, p.head_id ORDER BY day`).all(...wp, since);
  const heads = perHead.map((h) => ({ id: h.id, name: h.name, color: h.color }));
  const running = new Map(heads.map((h) => [h.id, 0]));
  for (const b of baseRows) running.set(b.head_id, b.n);
  const byDay = new Map();
  for (const d of daily) {
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    byDay.get(d.day).push(d);
  }
  const series = [];
  const start = new Date(since + 'T00:00:00Z');
  const today = new Date().toISOString().slice(0, 10);
  for (let t = start; t.toISOString().slice(0, 10) <= today; t = new Date(t.getTime() + 864e5)) {
    const day = t.toISOString().slice(0, 10);
    let newCount = 0;
    for (const d of byDay.get(day) || []) { running.set(d.head_id, (running.get(d.head_id) || 0) + d.n); newCount += d.n; }
    const values = {};
    for (const h of heads) values[h.id] = running.get(h.id) || 0;
    series.push({ day, values, new: newCount });
  }

  return { totals: { ...totals, heads: headsCount }, perHead, perLeader, recent, growth: { heads, series } };
}

/** Estadísticas de una rama (persona o líder). */
export function branchStats(person) {
  const lo = person.path; const hi = pathUpper(person.path);
  const s = q(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN is_leader = 1 THEN 1 ELSE 0 END) AS leaders,
        SUM(CASE WHEN registration_method = 'invitation' THEN 1 ELSE 0 END) AS via_invitation,
        MAX(depth) AS max_depth
      FROM people WHERE path > ? AND path < ? AND status <> 'rejected'`).get(lo, hi);
  const byLevel = q(`SELECT depth - ? AS level, COUNT(*) n FROM people WHERE path > ? AND path < ? AND status <> 'rejected'
                     GROUP BY depth ORDER BY depth LIMIT 30`).all(person.depth, lo, hi);
  const topInviters = q(`SELECT i.id, i.full_name, i.is_leader, COUNT(*) n FROM people c JOIN people i ON i.id = c.inviter_id
                         WHERE c.path > ? AND c.path < ? AND c.status <> 'rejected'
                         GROUP BY i.id ORDER BY n DESC LIMIT 8`).all(lo, hi);
  const assigned = q(`SELECT COUNT(*) n FROM people WHERE leader_id = ? AND status <> 'rejected'`).get(person.id).n;
  for (const k of Object.keys(s)) s[k] = s[k] ?? 0;
  s.max_depth = s.total ? s.max_depth - person.depth : 0;
  return { ...s, assigned, byLevel, topInviters: topInviters.map((t) => ({ ...t, is_leader: !!t.is_leader })) };
}

export function canView(user, person) { return canViewPerson(user, person); }
export { getDb };
