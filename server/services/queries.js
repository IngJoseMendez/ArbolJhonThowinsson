// Consultas de lectura: nodos del árbol, búsqueda, directorio y estadísticas.
import { q, pathUpper } from '../db.js';
import { scopeSql, canSeeContact, visibleHeadIds } from '../permissions.js';
import { normalizeText, normalizePhone, maskPhone } from '../util.js';
import { ancestorIds } from './people.js';

export const NODE_SELECT = `
  SELECT p.id, p.code, p.full_name, p.is_leader, p.is_head, p.leader_code, p.status, p.created_at, p.depth, p.inviter_id,
         p.leader_id, p.leader_mode, p.head_id, p.registration_method, p.path, p.city,
         p.child_count, p.descendant_count, p.geo_localidad_id, p.geo_comuna_id, p.geo_barrio_id, p.geo_status, p.reg_type_id,
         p.photo_url, p.is_direct, l.full_name AS leader_name, i.full_name AS inviter_name
    FROM people p
    LEFT JOIN people l ON l.id = p.leader_id
    LEFT JOIN people i ON i.id = p.inviter_id`;

const toNode = (r) => ({ ...r, is_leader: !!r.is_leader, is_head: !!r.is_head, is_direct: !!r.is_direct });

/** Hijos directos (árbol de invitación) con paginación. parentId = null => raíz de la cabeza. */
export async function treeChildren(user, headId, parentId, { offset = 0, limit = 100, include = null } = {}) {
  let rows;
  let total;
  if (parentId == null) {
    if (user.role === 'leader' || user.role === 'member') {
      // La raíz visible es la propia persona.
      const me = user.person && user.person.head_id === headId ? await q(`${NODE_SELECT} WHERE p.id = ?`).get(user.person.id) : null;
      return { nodes: me ? [toNode(me)] : [], total: me ? 1 : 0, offset: 0 };
    }
    total = (await q(`SELECT COUNT(*) n FROM people WHERE head_id = ? AND inviter_id IS NULL AND status <> 'rejected'`).get(headId)).n;
    rows = await q(`${NODE_SELECT} WHERE p.head_id = ? AND p.inviter_id IS NULL AND p.status <> 'rejected'
               ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`).all(headId, limit, offset);
  } else {
    total = (await q(`SELECT COUNT(*) n FROM people WHERE inviter_id = ? AND status <> 'rejected'`).get(parentId)).n;
    rows = await q(`${NODE_SELECT} WHERE p.inviter_id = ? AND p.status <> 'rejected'
               ORDER BY p.is_leader DESC, p.created_at, p.id LIMIT ? OFFSET ?`).all(parentId, limit, offset);
  }
  if (include && !rows.some((r) => r.id === include)) {
    const extra = await q(`${NODE_SELECT} WHERE p.id = ? AND p.status <> 'rejected'`).get(include);
    if (extra && (extra.inviter_id ?? null) === (parentId ?? null) && extra.head_id === headId) rows.push(extra);
  }
  return { nodes: rows.map(toNode), total, offset };
}

/**
 * La red completa: John Thowinsson es la raíz y la primera cabeza. De él cuelgan sus cabezas, cada una con su propio
 * árbol (o, si una estructura aún no tiene cabeza o algo cuelga suelto de ella, la estructura misma), y las personas que
 * él invita directamente, cada una como una rama más. Primero las cabezas, en el orden en que llegaron; luego sus
 * personas directas (líderes primero), de a `limit`: con `offset` sólo llegan más personas directas y `include` añade
 * a una de ellas aunque quede fuera de la página (para localizarla). `page`: cuántos nodos son de la página.
 */
export async function networkRoot(user, { offset = 0, limit = 50, include = null } = {}) {
  const ids = visibleHeadIds(user);
  const empty = { root: { heads: 0, people: 0, leaders: 0, last7: 0 }, nodes: [], total: 0, page: 0 };
  if (ids !== null && !ids.length) return empty;
  const scope = ids === null ? '' : ` AND h.id IN (${ids.map(() => '?').join(',')})`;
  const sp = ids || [];
  const heads = await q(`SELECT h.id, h.name, h.color, h.region, h.created_at, c.id AS cabeza_id, c.full_name AS cabeza_name,
        (SELECT COUNT(*) FROM people x WHERE x.head_id = h.id AND x.status <> 'rejected') AS people,
        (SELECT COUNT(*) FROM people r WHERE r.head_id = h.id AND r.inviter_id IS NULL AND r.status <> 'rejected') AS roots
      FROM heads h LEFT JOIN people c ON c.head_id = h.id AND c.is_head = 1 AND c.status <> 'rejected'
      WHERE h.status = 'active' AND h.is_direct = 0${scope}
      ORDER BY (c.id IS NULL), COALESCE(c.created_at, h.created_at), h.id LIMIT 1000`).all(...sp);
  const cabezaIds = heads.filter((h) => h.cabeza_id).map((h) => h.cabeza_id);
  const cabezas = cabezaIds.length && !offset
    ? await q(`${NODE_SELECT} WHERE p.id IN (${cabezaIds.map(() => '?').join(',')})`).all(...cabezaIds) : [];
  const byId = new Map(cabezas.map((c) => [c.id, toNode(c)]));
  const headNodes = offset ? [] : heads.map((h) => (byId.has(h.cabeza_id) && h.roots <= 1
    ? { kind: 'person', ...byId.get(h.cabeza_id), head_name: h.name, head_color: h.color }
    : { kind: 'head', id: h.id, name: h.name, color: h.color, region: h.region, created_at: h.created_at, people: h.people, cabeza_name: h.cabeza_name }));
  // Las personas que John invita directamente: ramas suyas, como sus cabezas.
  const direct = await q(`SELECT h.id FROM heads h WHERE h.status = 'active' AND h.is_direct = 1${scope}`).get(...sp);
  let directTotal = 0;
  let directRows = [];
  if (direct) {
    directTotal = (await q(`SELECT COUNT(*) n FROM people WHERE head_id = ? AND inviter_id IS NULL AND status <> 'rejected'`).get(direct.id)).n;
    directRows = await q(`${NODE_SELECT} WHERE p.head_id = ? AND p.inviter_id IS NULL AND p.status <> 'rejected'
        ORDER BY p.is_leader DESC, p.created_at, p.id LIMIT ? OFFSET ?`).all(direct.id, limit, offset);
  }
  const page = headNodes.length + directRows.length;
  if (direct && include && !directRows.some((r) => r.id === include)) {
    const extra = await q(`${NODE_SELECT} WHERE p.id = ? AND p.head_id = ? AND p.inviter_id IS NULL AND p.status <> 'rejected'`).get(include, direct.id);
    if (extra) directRows.push(extra);
  }
  const nodes = [...headNodes, ...directRows.map((r) => ({ kind: 'person', ...toNode(r) }))];
  const t = await q(`SELECT COUNT(*) AS people,
        SUM(CASE WHEN p.is_leader = 1 AND p.is_head = 0 THEN 1 ELSE 0 END) AS leaders,
        SUM(CASE WHEN p.created_at >= ? THEN 1 ELSE 0 END) AS last7
      FROM people p JOIN heads h ON h.id = p.head_id WHERE p.status <> 'rejected' AND h.status = 'active'${scope}`)
    .get(new Date(Date.now() - 7 * 864e5).toISOString(), ...sp);
  return { root: { heads: heads.length, people: t.people || 0, leaders: t.leaders || 0, last7: t.last7 || 0 }, nodes, total: heads.length + directTotal, page };
}

/**
 * Rama completa en bloques ordenados por ruta (carga progresiva para "Expandir todo").
 * rootId = null => toda la cabeza (o la rama propia para líderes y personas).
 * after = última ruta recibida (cursor). Devuelve nodos sin la raíz.
 */
export async function treeSubtree(user, headId, rootId, { after = null, limit = 2000 } = {}) {
  let lo; let hi; let extra = ''; const params = [];
  if (rootId) {
    const root = await q('SELECT path FROM people WHERE id = ?').get(rootId);
    lo = root.path; hi = pathUpper(root.path);
    extra = 'AND p.path > ? AND p.path < ?'; params.push(lo, hi);
  } else if (user.role === 'leader' || user.role === 'member') {
    lo = user.person.path; hi = pathUpper(lo);
    extra = 'AND p.path >= ? AND p.path < ?'; params.push(lo, hi);
  }
  if (after) { extra += ' AND p.path > ?'; params.push(String(after)); }
  const rows = await q(`${NODE_SELECT} WHERE p.head_id = ? AND p.status <> 'rejected' ${extra}
                        ORDER BY p.path LIMIT ?`).all(headId, ...params, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { nodes: page.map(toNode), next: more ? page[page.length - 1].path : null };
}

/** Hijos de varios nodos a la vez (restaurar ramas expandidas en una sola petición). */
export async function treeChildrenOf(parentIds, { limit = 20000 } = {}) {
  if (!parentIds.length) return [];
  const rows = await q(`${NODE_SELECT} WHERE p.inviter_id IN (${parentIds.map(() => '?').join(',')}) AND p.status <> 'rejected'
                        ORDER BY p.is_leader DESC, p.created_at, p.id LIMIT ?`).all(...parentIds, limit);
  return rows.map(toNode);
}

/** Cadena desde la raíz visible hasta la persona (para resaltar camino / localizar). */
export async function pathToPerson(user, person) {
  const ids = ancestorIds(person.path);
  const rows = await q(`${NODE_SELECT} WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, toNode(r)]));
  let chain = ids.map((id) => byId.get(id));
  if (user.role === 'leader' || user.role === 'member') {
    const idx = chain.findIndex((n) => n.id === user.person?.id);
    chain = idx >= 0 ? chain.slice(idx) : [chain[chain.length - 1]];
  }
  return chain;
}

export async function search(user, term, { headId = null, limit = 20 } = {}) {
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
  return (await q(`SELECT p.id, p.code, p.full_name, p.is_leader, p.is_head, p.leader_code, p.status, p.head_id, p.depth, p.phone, p.path, p.photo_url, p.is_direct,
                   h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, l.full_name AS leader_name
              FROM people p JOIN heads h ON h.id = p.head_id
              LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
             WHERE ${where}
             ORDER BY p.is_head DESC, p.is_leader DESC, p.full_name LIMIT ?`).all(...allParams, limit))
    .map((r) => ({ ...r, is_leader: !!r.is_leader, is_head: !!r.is_head, is_direct: !!r.is_direct, phone: canSeeContact(user, r) ? r.phone : maskPhone(r.phone), path: undefined }));
}

const SORTS = {
  full_name: 'p.name_key', created_at: 'p.created_at', head: 'h.name', leader: 'l.name_key', inviter: 'i.name_key',
  status: 'p.status', descendants: 'p.descendant_count', location: "COALESCE(gl.name, p.geo_localidad_text, '~')",
};

export async function directory(user, f) {
  const sc = scopeSql(user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (f.q) {
    const t = String(f.q).trim();
    const digits = normalizePhone(t);
    const ors = ['p.name_key LIKE ?', 'p.code = ?', 'p.leader_code LIKE ?',
      'lower(p.geo_localidad_text) LIKE ?', 'lower(p.geo_comuna_text) LIKE ?', 'lower(p.geo_barrio_text) LIKE ?'];
    const tl = `%${t.toLowerCase()}%`;
    params.push(`%${normalizeText(t)}%`, t.toUpperCase(), `%${t.toUpperCase()}%`, tl, tl, tl);
    if (user.role !== 'member') {
      ors.push('lower(p.address) LIKE ?'); params.push(tl);
      if (digits.length >= 4) { ors.push('p.phone LIKE ?', 'p.document_id LIKE ?'); params.push(`%${digits}%`, `%${digits}%`); }
    }
    where.push(`(${ors.join(' OR ')})`);
  }
  if (f.localidad_id) { where.push('p.geo_localidad_id = ?'); params.push(Number(f.localidad_id)); }
  if (f.comuna_id) { where.push('p.geo_comuna_id = ?'); params.push(Number(f.comuna_id)); }
  if (f.barrio_id) { where.push('p.geo_barrio_id = ?'); params.push(Number(f.barrio_id)); }
  if (f.geo_status && ['pending', 'verified', 'none'].includes(f.geo_status)) { where.push('p.geo_status = ?'); params.push(f.geo_status); }
  if (f.reg_type_id) { where.push('p.reg_type_id = ?'); params.push(Number(f.reg_type_id)); }
  if (f.supports === 'yes' || f.supports === 'no') { where.push('p.supports = ?'); params.push(f.supports); }
  else if (f.supports === 'unknown') where.push('p.supports IS NULL');
  if (f.secure_vote === 'yes' || f.secure_vote === 'no') { where.push('p.secure_vote = ?'); params.push(f.secure_vote); }
  else if (f.secure_vote === 'unknown') where.push('p.secure_vote IS NULL');
  if (f.head_id) { where.push('p.head_id = ?'); params.push(Number(f.head_id)); }
  if (f.leader_id) { where.push('p.leader_id = ?'); params.push(Number(f.leader_id)); }
  if (f.inviter_id) { where.push('p.inviter_id = ?'); params.push(Number(f.inviter_id)); }
  if (f.status) { where.push('p.status = ?'); params.push(String(f.status)); } else where.push(`p.status <> 'rejected'`);
  if (f.method) { where.push('p.registration_method = ?'); params.push(String(f.method)); }
  if (f.type === 'head') where.push('p.is_head = 1');
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
                LEFT JOIN geo_areas gl ON gl.id = p.geo_localidad_id LEFT JOIN geo_areas gc ON gc.id = p.geo_comuna_id
                LEFT JOIN geo_areas gb ON gb.id = p.geo_barrio_id
                WHERE ${where.join(' AND ')}`;
  const total = (await q(`SELECT COUNT(*) n ${base}`).get(...params)).n;
  const rows = await q(`SELECT p.id, p.code, p.full_name, p.phone, p.email, p.city, p.is_leader, p.is_head, p.leader_code, p.status,
                         p.registration_method, p.created_at, p.head_id, p.path, p.leader_id, p.inviter_id,
                         h.name AS head_name, h.color AS head_color, l.full_name AS leader_name, i.full_name AS inviter_name,
                         p.descendant_count, p.address, p.supports, p.secure_vote, p.reg_type_id, p.geo_status, p.geo_localidad_id, p.geo_comuna_id, p.geo_barrio_id, p.photo_url, p.is_direct,
                         COALESCE(gl.name, p.geo_localidad_text) AS localidad_name, COALESCE(gc.name, p.geo_comuna_text) AS comuna_name,
                         COALESCE(gb.name, p.geo_barrio_text) AS barrio_name, gc.kind AS comuna_kind
                  ${base} ORDER BY ${sortCol} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return {
    total, page, pageSize,
    rows: rows.map((r) => {
      const contact = canSeeContact(user, r);
      return {
        ...r, is_leader: !!r.is_leader, is_head: !!r.is_head, is_direct: !!r.is_direct, phone: contact ? r.phone : maskPhone(r.phone), email: contact ? r.email : null,
        address: contact ? r.address : null, path: undefined,
      };
    }),
  };
}

function headFilter(user, column) {
  const ids = visibleHeadIds(user);
  if (ids === null) return { sql: '1=1', params: [] };
  if (!ids.length) return { sql: '0=1', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Estadísticas del dashboard, siempre calculadas sobre la BD y dentro del alcance del usuario. */
export async function dashboard(user, { headId = null, days = 90 } = {}) {
  const sc = scopeSql(user);
  const hf = headFilter(user, 'h.id');
  const extra = headId ? ' AND p.head_id = ?' : '';
  const ep = headId ? [Number(headId)] : [];
  const w = `${sc.sql}${extra}`;
  const wp = [...sc.params, ...ep];

  const totals = await q(`SELECT
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

  const headsCount = (await q(`SELECT COUNT(*) n FROM heads h WHERE h.status = 'active' AND h.is_direct = 0 AND ${hf.sql}`).get(...hf.params)).n;

  const perHead = await q(`SELECT h.id, h.name, h.color,
        (SELECT c.full_name FROM people c WHERE c.head_id = h.id AND c.is_head = 1 AND c.status <> 'rejected') AS cabeza_name,
        COUNT(p.id) AS people,
        SUM(CASE WHEN p.is_leader = 1 THEN 1 ELSE 0 END) AS leaders,
        SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM heads h LEFT JOIN people p ON p.head_id = h.id AND p.status <> 'rejected' AND ${sc.sql}
      WHERE h.status = 'active' AND ${hf.sql} ${headId ? 'AND h.id = ?' : ''}
      GROUP BY h.id ORDER BY people DESC, h.name`).all(...sc.params, ...hf.params, ...ep);

  const scl = scopeSql(user, 'l');
  const perLeader = await q(`SELECT l.id, l.full_name, l.leader_code, l.head_id, l.is_head = 1 AS is_head, l.photo_url, h.name AS head_name, h.color AS head_color,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        l.descendant_count AS branch
      FROM people l JOIN heads h ON h.id = l.head_id
      WHERE l.is_leader = 1 AND l.status <> 'rejected' AND ${scl.sql} ${headId ? 'AND l.head_id = ?' : ''}
      ORDER BY assigned DESC, branch DESC LIMIT 12`).all(...scl.params, ...ep);

  const recent = await q(`SELECT p.id, p.code, p.full_name, p.is_leader, p.is_head = 1 AS is_head, p.is_direct = 1 AS is_direct, p.status, p.registration_method, p.created_at, p.head_id, p.photo_url,
        h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, i.id AS inviter_id, l.full_name AS leader_name
      FROM people p JOIN heads h ON h.id = p.head_id LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
      WHERE ${w} AND p.status <> 'rejected' ORDER BY p.created_at DESC, p.id DESC LIMIT 12`).all(...wp);

  // Crecimiento: acumulado diario por cabeza en la ventana solicitada.
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const baseRows = await q(`SELECT p.head_id, COUNT(*) n FROM people p WHERE ${w} AND p.status <> 'rejected' AND p.created_at < ?
                      GROUP BY p.head_id`).all(...wp, since);
  const daily = await q(`SELECT substr(p.created_at, 1, 10) AS day, p.head_id, COUNT(*) n FROM people p
                   WHERE ${w} AND p.status <> 'rejected' AND p.created_at >= ? GROUP BY day, p.head_id ORDER BY day`).all(...wp, since);
  // En las gráficas, cada estructura se nombra por su cabeza (si la tiene); quienes están directo con John, «Directo con John».
  const heads = perHead.map((h) => ({ id: h.id, name: h.cabeza_name || h.name, color: h.color }));
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
export async function branchStats(person) {
  const lo = person.path; const hi = pathUpper(person.path);
  const s = await q(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN is_leader = 1 THEN 1 ELSE 0 END) AS leaders,
        SUM(CASE WHEN registration_method = 'invitation' THEN 1 ELSE 0 END) AS via_invitation,
        MAX(depth) AS max_depth
      FROM people WHERE path > ? AND path < ? AND status <> 'rejected'`).get(lo, hi);
  const byLevel = await q(`SELECT depth - ?::int AS level, COUNT(*) n FROM people WHERE path > ? AND path < ? AND status <> 'rejected'
                     GROUP BY depth ORDER BY depth LIMIT 30`).all(person.depth, lo, hi);
  const topInviters = await q(`SELECT i.id, i.full_name, i.is_leader, COUNT(*) n FROM people c JOIN people i ON i.id = c.inviter_id
                         WHERE c.path > ? AND c.path < ? AND c.status <> 'rejected'
                         GROUP BY i.id ORDER BY n DESC LIMIT 8`).all(lo, hi);
  const assigned = (await q(`SELECT COUNT(*) n FROM people WHERE leader_id = ? AND status <> 'rejected'`).get(person.id)).n;
  for (const k of Object.keys(s)) s[k] = s[k] ?? 0;
  s.max_depth = s.total ? s.max_depth - person.depth : 0;
  return { ...s, assigned, byLevel, topInviters: topInviters.map((t) => ({ ...t, is_leader: !!t.is_leader })) };
}

