// Panel privado del líder y de la cabeza: sin cuenta. Se abre con un enlace secreto + PIN
// (últimos 4 dígitos de la cédula). El enlace se guarda como huella (sha256) y se puede revocar o regenerar.
// La cabeza ve toda su estructura y, además, invita líderes con enlaces de un solo uso.
import { q, now, pathUpper } from '../db.js';
import { AppError, notFound, sha256, normalizeText, maskPhone } from '../util.js';
import { createHeadLeaderInvite, headInviteStats, headPerson } from './people.js';

const FAILS = new Map(); // huella del enlace -> { count, reset }
const MAX_FAILS = 8;
const WINDOW = 15 * 60e3;

const pinOf = (p) => String(p.document_id || p.phone || '').replace(/\D/g, '').slice(-4);

function checkPin(p, pin) {
  const k = p.panel_token_hash;
  const t = Date.now();
  let e = FAILS.get(k);
  if (e && e.reset < t) { FAILS.delete(k); e = null; }
  if (e && e.count >= MAX_FAILS) throw new AppError(429, 'PIN_LOCKED', 'Demasiados intentos fallidos. Espere 15 minutos.');
  if (!pin) throw new AppError(401, 'PIN_REQUIRED', 'Escriba los últimos 4 dígitos de su cédula.');
  if (String(pin).replace(/\D/g, '') !== pinOf(p)) {
    if (!e) { e = { count: 0, reset: t + WINDOW }; FAILS.set(k, e); }
    e.count++;
    if (FAILS.size > 10000) for (const [kk, v] of FAILS) if (v.reset < t) FAILS.delete(kk);
    throw new AppError(401, 'PIN_INVALID', `PIN incorrecto. Le quedan ${MAX_FAILS - e.count} intentos.`);
  }
  FAILS.delete(k);
}

/** Valida enlace + PIN y devuelve la persona dueña del panel. */
async function openPanel(token, pin) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(String(token || ''))) throw notFound('Este panel no existe o fue desactivado.');
  const p = await q('SELECT * FROM people WHERE panel_token_hash = ?').get(sha256(String(token)));
  if (!p || p.status === 'rejected') throw notFound('Este panel no existe o fue desactivado.');
  checkPin(p, pin);
  return p;
}

/** Datos del panel: resumen y personas de su rama (contactos enmascarados); la cabeza ve además a sus líderes. */
export async function panelData(token, pin, { q: term = '', page = 1 } = {}) {
  const p = await openPanel(token, pin);
  await q('UPDATE people SET panel_viewed_at = ? WHERE id = ?').run(now(), p.id);

  const lo = p.path;
  const hi = pathUpper(p.path);
  const branch = `FROM people x WHERE x.path > ? AND x.path < ? AND x.status <> 'rejected'`;
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const s = await q(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN x.inviter_id = ? THEN 1 ELSE 0 END) AS direct,
      SUM(CASE WHEN x.created_at >= ? THEN 1 ELSE 0 END) AS last7,
      SUM(CASE WHEN x.created_at >= ? THEN 1 ELSE 0 END) AS last30,
      SUM(CASE WHEN x.supports = 'yes' THEN 1 ELSE 0 END) AS supports_yes,
      SUM(CASE WHEN x.secure_vote = 'yes' THEN 1 ELSE 0 END) AS secure_votes,
      SUM(CASE WHEN x.is_leader = 1 THEN 1 ELSE 0 END) AS leaders,
      SUM(CASE WHEN x.status = 'pending' THEN 1 ELSE 0 END) AS pending ${branch}`).get(p.id, since(7), since(30), lo, hi);

  const pageSize = 50;
  const pg = Math.max(1, Number(page) || 1);
  const params = [lo, hi];
  let extra = '';
  if (String(term).trim().length >= 2) { extra = ' AND x.name_key LIKE ?'; params.push(`%${normalizeText(term)}%`); }
  const total = (await q(`SELECT COUNT(*) AS n ${branch}${extra}`).get(...params)).n;
  const rows = await q(`SELECT x.id, x.full_name, x.phone, x.status, x.created_at, x.supports, x.is_leader, x.inviter_id, x.depth,
        x.descendant_count, i.full_name AS inviter_name, rt.name AS type_name, rt.color AS type_color,
        COALESCE(gb.name, x.geo_barrio_text) AS barrio, COALESCE(gl.name, x.geo_localidad_text) AS localidad
      FROM people x LEFT JOIN people i ON i.id = x.inviter_id LEFT JOIN reg_types rt ON rt.id = x.reg_type_id
      LEFT JOIN geo_areas gb ON gb.id = x.geo_barrio_id LEFT JOIN geo_areas gl ON gl.id = x.geo_localidad_id
      WHERE x.path > ? AND x.path < ? AND x.status <> 'rejected'${extra}
      ORDER BY x.created_at DESC, x.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (pg - 1) * pageSize);

  // La cabeza ve a los líderes de su estructura con el tamaño de su red y su ritmo reciente.
  let leaders = null;
  if (p.is_head && pg === 1 && !extra) {
    leaders = (await q(`SELECT x.id, x.full_name, x.status, x.created_at, x.child_count AS direct, x.descendant_count AS network,
          (SELECT COUNT(*) FROM people y WHERE y.path > x.path AND y.path < CONCAT(x.path, '~') AND y.status <> 'rejected'
             AND y.created_at >= ?) AS last7
        FROM people x WHERE x.path > ? AND x.path < ? AND x.is_leader = 1 AND x.status <> 'rejected'
        ORDER BY x.descendant_count DESC, x.full_name LIMIT 200`).all(since(7), lo, hi));
  }

  const type = p.reg_type_id ? await q('SELECT name, color, role FROM reg_types WHERE id = ?').get(p.reg_type_id) : null;
  const head = await q('SELECT name, color FROM heads WHERE id = ?').get(p.head_id);
  const cabeza = p.is_head ? null : await headPerson(p.head_id);
  const link = await q(`SELECT token FROM invite_links WHERE owner_person_id = ? AND kind IN ('leader','person') AND status = 'active'
                        ORDER BY id DESC LIMIT 1`).get(p.id);
  return {
    person: {
      full_name: p.full_name, first_names: p.first_names, code: p.code, leader_code: p.leader_code, is_leader: !!p.is_leader,
      is_head: !!p.is_head, status: p.status, created_at: p.created_at,
    },
    type, head: head && { ...head, cabeza: cabeza && cabeza.status !== 'rejected' ? cabeza.full_name : null },
    invite_token: link?.token ?? null,
    leader_invites: p.is_head ? await headInviteStats(p.id) : null,
    leaders,
    stats: {
      total: s.total || 0, direct: s.direct || 0, last7: s.last7 || 0, last30: s.last30 || 0,
      supports_yes: s.supports_yes || 0, secure_votes: s.secure_votes || 0, pending: s.pending || 0, leaders: s.leaders || 0,
    },
    people: {
      total, page: pg, pageSize,
      rows: rows.map((r) => ({
        ...r, is_leader: !!r.is_leader, phone: maskPhone(r.phone), direct: r.inviter_id === p.id,
        level: r.depth - p.depth, inviter_id: undefined, depth: undefined,
      })),
    },
  };
}

/** La cabeza genera, desde su panel, un enlace de un solo uso para invitar a un líder. */
export async function panelLeaderInvite(token, pin, ip) {
  const p = await openPanel(token, pin);
  return await createHeadLeaderInvite(p, ip);
}

/** Manifiesto de la app instalable de un panel: al abrirla desde el inicio del celular entra directo al panel. */
export function panelManifest(start) {
  const ok = /^\/panel\/[A-Za-z0-9_-]{20,60}$/.test(String(start || ''));
  const startUrl = ok ? start : '/';
  return {
    id: startUrl,
    name: 'Mi panel · Thowinsson',
    short_name: 'Mi panel',
    description: 'Tu red en el equipo de John Thowinsson.',
    lang: 'es-CO',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#05204a',
    theme_color: '#05204a',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
