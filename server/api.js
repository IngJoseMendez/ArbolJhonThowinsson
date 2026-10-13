import express from 'express';
import { q, tx, now } from './db.js';
import {
  requireAuth, requireRole, rateLimit, createSession, destroySession, setSessionCookie, clearSessionCookie,
  verifyPassword, hashPassword,
} from './auth.js';
import {
  ROLES, isAdmin, canManageHead, canViewHead, canViewPerson, canManagePerson, canSeeContact, visibleHeadIds, assert, scopeSql,
} from './permissions.js';
import {
  createPerson, registerViaInvite, resolveInvite, promoteToLeader, demoteLeader, setResponsibleLeader, movePerson,
  setStatus, updatePersonData, regeneratePersonLink, integrityReport, getPerson, getHead, findDuplicate,
} from './services/people.js';
import { treeChildren, pathToPerson, search, directory, dashboard, branchStats, NODE_SELECT } from './services/queries.js';
import { audit } from './services/audit.js';
import {
  badRequest, notFound, forbidden, str, intOrNull, slugLower, maskPhone, normalizePhone, normalizeDocument, AppError, sha256,
} from './util.js';

export const api = express.Router();
const HEAD_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const ip = (req) => req.ip;

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------
api.post('/auth/login', rateLimit({ windowMs: 15 * 60e3, max: 20 }), (req, res) => {
  const username = str(req.body.username, { field: 'usuario', required: true, max: 80 });
  const password = String(req.body.password ?? '');
  const u = q('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || u.status !== 'active' || !verifyPassword(password, u.password_hash)) {
    audit(null, 'auth.login_failed', 'user', u?.id ?? null, { username }, ip(req));
    throw new AppError(401, 'BAD_CREDENTIALS', 'Usuario o contraseña incorrectos.');
  }
  const { token, expires } = createSession(u.id);
  setSessionCookie(res, token, expires);
  audit(u, 'auth.login', 'user', u.id, {}, ip(req));
  res.json({ ok: true });
});

api.post('/auth/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const heads = visibleHeadIds(u);
  let person = null;
  if (u.person) {
    const p = getPerson(u.person.id);
    person = { id: p.id, full_name: p.full_name, code: p.code, is_leader: !!p.is_leader, head_id: p.head_id, status: p.status };
  }
  res.json({
    user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, role_label: ROLES[u.role], head_ids: heads },
    person,
  });
});

api.post('/me/password', requireAuth, rateLimit({ windowMs: 15 * 60e3, max: 10 }), (req, res) => {
  const u = q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body.current ?? ''), u.password_hash)) throw badRequest('BAD_PASSWORD', 'La contraseña actual no es correcta.');
  const next = String(req.body.password ?? '');
  if (next.length < 8) throw badRequest('VALIDATION', 'La nueva contraseña debe tener al menos 8 caracteres.');
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
  q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, sha256(req.sessionToken));
  audit(req.user, 'user.password_change', 'user', u.id, {}, ip(req));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cabezas
// ---------------------------------------------------------------------------
const headCounts = `
  (SELECT COUNT(*) FROM people p WHERE p.head_id = h.id AND p.status <> 'rejected') AS people,
  (SELECT COUNT(*) FROM people p WHERE p.head_id = h.id AND p.is_leader = 1 AND p.status <> 'rejected') AS leaders,
  (SELECT COUNT(*) FROM people p WHERE p.head_id = h.id AND p.status = 'pending') AS pending,
  (SELECT COUNT(*) FROM people p WHERE p.head_id = h.id AND p.status <> 'rejected' AND p.created_at >= ?) AS last30`;

api.get('/heads', requireAuth, (req, res) => {
  const ids = visibleHeadIds(req.user);
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let rows;
  if (ids === null) rows = q(`SELECT h.*, ${headCounts} FROM heads h ORDER BY h.status, h.name`).all(since);
  else if (!ids.length) rows = [];
  else rows = q(`SELECT h.*, ${headCounts} FROM heads h WHERE h.id IN (${ids.map(() => '?').join(',')}) ORDER BY h.status, h.name`).all(since, ...ids);
  // Líderes y personas sólo ven totales de su alcance, no de toda la cabeza.
  if (!isAdmin(req.user)) rows = rows.map((r) => ({ ...r, people: null, leaders: null, pending: null, last30: null }));
  res.json(rows.map((r) => ({ ...r, requires_approval: !!r.requires_approval, person_invites_enabled: !!r.person_invites_enabled, can_manage: canManageHead(req.user, r.id) })));
});

function headInput(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { field: 'nombre', required: true, min: 2, max: 80 });
  if (!partial || body.description !== undefined) out.description = str(body.description, { field: 'descripción', max: 500 });
  if (!partial || body.region !== undefined) out.region = str(body.region, { field: 'región', max: 80 });
  if (body.color !== undefined || !partial) {
    // Por defecto, el siguiente color libre de la paleta categórica validada.
    const used = new Set(q('SELECT color FROM heads').all().map((r) => r.color));
    const c = String(body.color || HEAD_COLORS.find((x) => !used.has(x)) || HEAD_COLORS[0]);
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw badRequest('VALIDATION', 'Color no válido.');
    out.color = c;
  }
  if (body.requires_approval !== undefined) out.requires_approval = body.requires_approval ? 1 : 0;
  if (body.person_invites_enabled !== undefined) out.person_invites_enabled = body.person_invites_enabled ? 1 : 0;
  if (body.status !== undefined) {
    if (!['active', 'archived'].includes(body.status)) throw badRequest('VALIDATION', 'Estado no válido.');
    out.status = body.status;
  }
  return out;
}

api.post('/heads', requireRole('super_admin'), (req, res) => {
  const d = headInput(req.body);
  if (q('SELECT 1 FROM heads WHERE name = ?').get(d.name)) throw badRequest('DUPLICATE', 'Ya existe una cabeza con ese nombre.');
  let slug = slugLower(d.name);
  for (let i = 2; q('SELECT 1 FROM heads WHERE slug = ?').get(slug); i++) slug = `${slugLower(d.name)}-${i}`;
  const r = q(`INSERT INTO heads (name, slug, description, region, color, requires_approval, person_invites_enabled, created_by)
               VALUES (?,?,?,?,?,?,?,?)`).run(d.name, slug, d.description, d.region, d.color, d.requires_approval ?? 0,
    d.person_invites_enabled ?? 1, req.user.id);
  const id = Number(r.lastInsertRowid);
  audit(req.user, 'head.create', 'head', id, d, ip(req));
  res.status(201).json(getHead(id));
});

api.get('/heads/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const h = getHead(id);
  if (!h || !canViewHead(req.user, id)) throw notFound('Cabeza no encontrada.');
  const stats = dashboard(req.user, { headId: id, days: 60 });
  const sc = scopeSql(req.user, 'l');
  const leaders = q(`SELECT l.id, l.full_name, l.leader_code, l.status, l.created_at, l.inviter_id, i.full_name AS inviter_name,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        (SELECT COUNT(*) FROM people d WHERE d.path > l.path AND d.path < l.path || '~' AND d.status <> 'rejected') AS branch
      FROM people l LEFT JOIN people i ON i.id = l.inviter_id
      WHERE l.head_id = ? AND l.is_leader = 1 AND l.status <> 'rejected' AND ${sc.sql}
      ORDER BY l.depth, l.full_name`).all(id, ...sc.params);
  res.json({
    head: { ...h, requires_approval: !!h.requires_approval, person_invites_enabled: !!h.person_invites_enabled },
    can_manage: canManageHead(req.user, id),
    stats, leaders,
  });
});

api.patch('/heads/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const h = getHead(id);
  if (!h) throw notFound();
  assert(canManageHead(req.user, id), 'No administra esta cabeza.');
  const d = headInput(req.body, true);
  if (d.status && req.user.role !== 'super_admin') throw forbidden('Sólo el administrador general puede archivar cabezas.');
  if (d.name && q('SELECT 1 FROM heads WHERE name = ? AND id <> ?').get(d.name, id)) throw badRequest('DUPLICATE', 'Ya existe una cabeza con ese nombre.');
  const keys = Object.keys(d);
  if (keys.length) {
    q(`UPDATE heads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => d[k]), now(), id);
    audit(req.user, 'head.update', 'head', id, d, ip(req));
  }
  res.json(getHead(id));
});

// ---------------------------------------------------------------------------
// Árbol y búsqueda
// ---------------------------------------------------------------------------
api.get('/tree/:headId/children', requireAuth, (req, res) => {
  const headId = Number(req.params.headId);
  if (!getHead(headId) || !canViewHead(req.user, headId)) throw notFound('Cabeza no encontrada.');
  const parentId = intOrNull(req.query.parent, 'parent');
  if (parentId) {
    const parent = getPerson(parentId);
    if (!parent || parent.head_id !== headId || !canViewPerson(req.user, parent)) throw notFound('Nodo no encontrado.');
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const include = intOrNull(req.query.include, 'include');
  const r = treeChildren(req.user, headId, parentId, { limit, offset, include });
  r.nodes = r.nodes.filter((n) => canViewPerson(req.user, n)).map((n) => ({ ...n, path: undefined }));
  res.json(r);
});

api.get('/tree/path/:personId', requireAuth, (req, res) => {
  const p = getPerson(Number(req.params.personId));
  if (!p || p.status === 'rejected' || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  res.json({ head_id: p.head_id, chain: pathToPerson(req.user, p).map((n) => ({ ...n, path: undefined })) });
});

api.get('/search', requireAuth, (req, res) => {
  res.json(search(req.user, req.query.q, { headId: intOrNull(req.query.head_id, 'head_id') }));
});

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
api.get('/people', requireAuth, (req, res) => res.json(directory(req.user, req.query)));

api.get('/people/check-duplicate', requireRole('super_admin', 'head_admin'), (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const document_id = normalizeDocument(req.query.document_id);
  if (phone.length < 7 && !document_id) return res.json({ duplicate: null });
  const d = findDuplicate({ phone: phone.length >= 7 ? phone : '__none__', document_id });
  if (!d) return res.json({ duplicate: null });
  const visible = canManageHead(req.user, d.person.head_id);
  res.json({ duplicate: { field: d.field, ...(visible ? d.person : { head_id: null }) } });
});

api.post('/people', requireRole('super_admin', 'head_admin'), (req, res) => {
  const headId = intOrNull(req.body.head_id, 'head_id');
  if (!headId) throw badRequest('VALIDATION', 'Debe seleccionar la cabeza.', { field: 'head_id' });
  assert(canManageHead(req.user, headId), 'No administra esta cabeza.');
  const p = createPerson({
    data: req.body,
    headId,
    inviterId: intOrNull(req.body.inviter_id, 'inviter_id'),
    isLeader: !!req.body.is_leader,
    leaderOverrideId: intOrNull(req.body.leader_id, 'leader_id'),
    method: 'manual',
    user: req.user,
    status: 'active',
    consent: !!req.body.consent,
    reason: req.body.reason ? str(req.body.reason, { field: 'motivo', max: 300 }) : null,
    ip: ip(req),
  });
  res.status(201).json(p);
});

function loadVisiblePerson(req) {
  const p = getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  return p;
}

function linkWithUses(l) {
  if (!l) return null;
  const u = q(`SELECT COUNT(*) total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) pending, MAX(created_at) last_used
               FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(l.id);
  return { ...l, uses: u.total, pending: u.pending ?? 0, last_used: u.last_used };
}

api.get('/people/:id', requireAuth, (req, res) => {
  const p = loadVisiblePerson(req);
  const u = req.user;
  const manage = canManagePerson(u, p);
  const contact = canSeeContact(u, p);
  const head = getHead(p.head_id);
  const leader = p.leader_id ? q('SELECT id, full_name, leader_code, code FROM people WHERE id = ?').get(p.leader_id) : null;
  const inviter = p.inviter_id ? q('SELECT id, full_name, code, is_leader, leader_code FROM people WHERE id = ?').get(p.inviter_id) : null;
  const registeredBy = p.registered_by_user_id ? q('SELECT id, display_name, role FROM users WHERE id = ?').get(p.registered_by_user_id) : null;
  const viaLink = p.invite_link_id ? q('SELECT id, token, kind, owner_person_id FROM invite_links WHERE id = ?').get(p.invite_link_id) : null;
  const invitees = q(`${NODE_SELECT} WHERE p.inviter_id = ? AND p.status <> 'rejected' ORDER BY p.created_at LIMIT 200`).all(p.id)
    .map((n) => ({ ...n, is_leader: !!n.is_leader, path: undefined }));
  const isSelf = u.person?.id === p.id;
  const links = (manage || isSelf || (u.role === 'leader' && canViewPerson(u, p)))
    ? q('SELECT * FROM invite_links WHERE owner_person_id = ? ORDER BY status, id DESC').all(p.id).map(linkWithUses) : [];
  const SAFE = new Set(['registered', 'promoted_leader', 'demoted_leader', 'moved', 'moved_head', 'approved', 'leader_changed']);
  const history = q(`SELECT h.*, u.display_name AS changed_by_name FROM person_history h LEFT JOIN users u ON u.id = h.changed_by
                     WHERE h.person_id = ? ORDER BY h.id DESC LIMIT 200`).all(p.id)
    .filter((h) => manage || isSelf || SAFE.has(h.change_type))
    .map((h) => ({ ...h, details: JSON.parse(h.details) }));
  const account = manage ? q('SELECT id, username, role, status, last_login_at FROM users WHERE person_id = ?').get(p.id) : null;
  // Nombres referenciados en el historial (sólo de personas visibles para el usuario).
  const pids = new Set(); const hids = new Set();
  for (const h of history) {
    const d = h.details;
    for (const k of ['inviter_id', 'leader_id', 'from', 'to', 'from_inviter_id', 'to_inviter_id', 'via_branch_of']) {
      if (Number.isInteger(d[k])) pids.add(d[k]);
    }
    for (const k of ['head_id', 'from_head_id', 'to_head_id']) if (Number.isInteger(d[k])) hids.add(d[k]);
  }
  const names = { people: {}, heads: {} };
  for (const pid of pids) {
    const r = getPerson(pid);
    if (r) names.people[pid] = canViewPerson(u, r) || r.id === p.inviter_id || r.id === p.leader_id ? r.full_name : 'Persona fuera de su alcance';
  }
  for (const hid of hids) { const r = getHead(hid); if (r) names.heads[hid] = r.name; }
  res.json({
    person: {
      ...p, is_leader: !!p.is_leader, path: undefined, registration_ip: undefined,
      phone: contact ? p.phone : maskPhone(p.phone), email: contact ? p.email : null,
      document_id: contact ? p.document_id : null, notes: manage ? p.notes : '',
    },
    head: { id: head.id, name: head.name, color: head.color, person_invites_enabled: !!head.person_invites_enabled },
    leader, inviter: inviter ? { ...inviter, is_leader: !!inviter.is_leader } : null,
    registered_by: registeredBy, via_link: viaLink, invitees, links, history, account, names,
    stats: branchStats(p),
    chain: pathToPerson(u, p).map((n) => ({ id: n.id, full_name: n.full_name, is_leader: n.is_leader, code: n.code })),
    permissions: { manage, contact, super: u.role === 'super_admin', self: isSelf },
  });
});

const reasonOf = (req, required = false) => {
  const r = str(req.body.reason, { field: 'motivo', max: 300, required });
  return r || null;
};

function loadManagedPerson(req) {
  const p = getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  assert(canManagePerson(req.user, p), 'No tiene permisos para modificar a esta persona.');
  return p;
}

api.patch('/people/:id', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  res.json(updatePersonData(p.id, req.body, req.user, ip(req)));
});

api.post('/people/:id/promote', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  res.json(promoteToLeader(p.id, req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/demote', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  res.json(demoteLeader(p.id, req.user, reasonOf(req, true), ip(req)));
});

api.post('/people/:id/leader', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  res.json(setResponsibleLeader(p.id, intOrNull(req.body.leader_id, 'leader_id'), req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/status', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  const status = String(req.body.status || '');
  res.json(setStatus(p.id, status, req.user, reasonOf(req, status !== 'active'), ip(req)));
});

api.post('/people/:id/move', requireAuth, (req, res) => {
  const p = loadManagedPerson(req);
  const newInviterId = intOrNull(req.body.inviter_id, 'inviter_id');
  let newHeadId = intOrNull(req.body.head_id, 'head_id');
  if (newInviterId) {
    const t = getPerson(newInviterId);
    if (!t) throw badRequest('VALIDATION', 'El nuevo invitador no existe.');
    newHeadId = newHeadId ?? t.head_id;
  }
  newHeadId = newHeadId ?? p.head_id;
  // Mover entre cabezas exige administrar ambas cabezas.
  assert(canManageHead(req.user, newHeadId), 'No administra la cabeza de destino.');
  res.json(movePerson(p.id, { newInviterId, newHeadId }, req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/link', requireAuth, (req, res) => {
  const p = getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  // La propia persona puede generar su invitación; los administradores, la de cualquiera en su ámbito.
  assert(canManagePerson(req.user, p) || req.user.person?.id === p.id, 'No puede generar invitaciones para esta persona.');
  res.json(linkWithUses(regeneratePersonLink(p.id, req.user, ip(req))));
});

// ---------------------------------------------------------------------------
// Líderes
// ---------------------------------------------------------------------------
api.get('/leaders', requireAuth, (req, res) => {
  const sc = scopeSql(req.user, 'l');
  const params = [...sc.params];
  let extra = '';
  if (req.query.head_id) { extra += ' AND l.head_id = ?'; params.push(Number(req.query.head_id)); }
  if (req.query.q) { extra += ' AND (l.name_key LIKE ? OR l.leader_code LIKE ?)'; params.push(`%${String(req.query.q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`, `%${String(req.query.q).toUpperCase()}%`); }
  const rows = q(`SELECT l.id, l.code, l.full_name, l.leader_code, l.leader_since, l.status, l.head_id, l.inviter_id, l.created_at, l.city,
        h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, sup.full_name AS supervisor_name,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        (SELECT COUNT(*) FROM people d WHERE d.path > l.path AND d.path < l.path || '~' AND d.status <> 'rejected') AS branch,
        (SELECT COUNT(*) FROM people c WHERE c.inviter_id = l.id AND c.status <> 'rejected') AS direct,
        (SELECT token FROM invite_links k WHERE k.owner_person_id = l.id AND k.kind = 'leader' AND k.status = 'active' ORDER BY k.id DESC LIMIT 1) AS link_token,
        (SELECT COUNT(*) FROM people r JOIN invite_links k ON k.id = r.invite_link_id WHERE k.owner_person_id = l.id AND k.kind = 'leader' AND r.status <> 'rejected') AS link_uses
      FROM people l JOIN heads h ON h.id = l.head_id LEFT JOIN people i ON i.id = l.inviter_id LEFT JOIN people sup ON sup.id = l.leader_id
      WHERE l.is_leader = 1 AND l.status <> 'rejected' AND ${sc.sql} ${extra}
      ORDER BY h.name, branch DESC, l.full_name LIMIT 500`).all(...params);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Enlaces e invitaciones
// ---------------------------------------------------------------------------
api.get('/links', requireAuth, (req, res) => {
  const sc = scopeSql(req.user, 'o');
  const params = [...sc.params];
  const where = [sc.sql];
  if (req.query.head_id) { where.push('o.head_id = ?'); params.push(Number(req.query.head_id)); }
  if (req.query.kind) { where.push('k.kind = ?'); params.push(String(req.query.kind)); }
  if (req.query.status) { where.push('k.status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) {
    where.push('(o.name_key LIKE ? OR k.token LIKE ?)');
    params.push(`%${String(req.query.q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`, `%${String(req.query.q).toUpperCase()}%`);
  }
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const base = `FROM invite_links k JOIN people o ON o.id = k.owner_person_id JOIN heads h ON h.id = o.head_id
                LEFT JOIN users du ON du.id = k.disabled_by WHERE ${where.join(' AND ')}`;
  const total = q(`SELECT COUNT(*) n ${base}`).get(...params).n;
  const rows = q(`SELECT k.*, o.full_name AS owner_name, o.code AS owner_code, o.is_leader AS owner_is_leader, o.status AS owner_status,
        o.head_id, h.name AS head_name, h.color AS head_color, du.display_name AS disabled_by_name,
        (SELECT COUNT(*) FROM people r WHERE r.invite_link_id = k.id AND r.status <> 'rejected') AS uses,
        (SELECT COUNT(*) FROM people r WHERE r.invite_link_id = k.id AND r.status = 'pending') AS pending,
        (SELECT MAX(created_at) FROM people r WHERE r.invite_link_id = k.id) AS last_used
      ${base} ORDER BY uses DESC, k.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, rows: rows.map((r) => ({ ...r, owner_is_leader: !!r.owner_is_leader, can_manage: canManageHead(req.user, r.head_id) })) });
});

function loadManagedLink(req) {
  const l = q('SELECT k.*, o.head_id FROM invite_links k JOIN people o ON o.id = k.owner_person_id WHERE k.id = ?').get(Number(req.params.id));
  if (!l) throw notFound('Enlace no encontrado.');
  assert(canManageHead(req.user, l.head_id), 'No administra la cabeza de este enlace.');
  return l;
}

api.post('/links/:id/disable', requireAuth, (req, res) => {
  const l = loadManagedLink(req);
  const reason = reasonOf(req, true);
  q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = ? WHERE id = ?`)
    .run(now(), req.user.id, reason, l.id);
  audit(req.user, 'link.disable', 'invite_link', l.id, { token: l.token, reason }, ip(req));
  res.json({ ok: true });
});

api.post('/links/:id/enable', requireAuth, (req, res) => {
  const l = loadManagedLink(req);
  const owner = getPerson(l.owner_person_id);
  if (owner.status !== 'active') throw badRequest('NOT_ACTIVE', 'El propietario del enlace no está activo.');
  if (l.kind === 'leader' && !owner.is_leader) throw badRequest('NOT_LEADER', 'El propietario ya no es líder.');
  const other = q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = ? AND status = 'active' AND id <> ?`).get(owner.id, l.kind, l.id);
  if (other) throw badRequest('ALREADY_ACTIVE', 'La persona ya tiene otro enlace activo de este tipo. Desactívelo primero.');
  q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
  audit(req.user, 'link.enable', 'invite_link', l.id, { token: l.token }, ip(req));
  res.json({ ok: true });
});

api.patch('/links/:id', requireAuth, (req, res) => {
  const l = loadManagedLink(req);
  const maxUses = req.body.max_uses === null || req.body.max_uses === '' ? null : intOrNull(req.body.max_uses, 'max_uses');
  let expires = req.body.expires_at || null;
  if (expires && Number.isNaN(Date.parse(expires))) throw badRequest('VALIDATION', 'Fecha de caducidad no válida.');
  if (expires) expires = new Date(expires).toISOString();
  q('UPDATE invite_links SET max_uses = ?, expires_at = ? WHERE id = ?').run(maxUses, expires, l.id);
  audit(req.user, 'link.update', 'invite_link', l.id, { max_uses: maxUses, expires_at: expires }, ip(req));
  res.json({ ok: true });
});

api.get('/pending', requireRole('super_admin', 'head_admin'), (req, res) => {
  const sc = scopeSql(req.user);
  const rows = q(`SELECT p.id, p.code, p.full_name, p.phone, p.city, p.created_at, p.head_id, h.name AS head_name, h.color AS head_color,
        i.full_name AS inviter_name, i.id AS inviter_id, l.full_name AS leader_name, k.token AS link_token, k.kind AS link_kind
      FROM people p JOIN heads h ON h.id = p.head_id LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
      LEFT JOIN invite_links k ON k.id = p.invite_link_id
      WHERE p.status = 'pending' AND ${sc.sql} ORDER BY p.created_at LIMIT 500`).all(...sc.params);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------
api.get('/stats/dashboard', requireAuth, (req, res) => {
  const headId = intOrNull(req.query.head_id, 'head_id');
  if (headId && !canViewHead(req.user, headId)) throw notFound();
  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 730);
  res.json(dashboard(req.user, { headId, days }));
});

// ---------------------------------------------------------------------------
// Usuarios y roles
// ---------------------------------------------------------------------------
api.get('/users', requireRole('super_admin', 'head_admin'), (req, res) => {
  let rows = q(`SELECT u.id, u.username, u.display_name, u.role, u.status, u.person_id, u.created_at, u.last_login_at,
                       p.full_name AS person_name, p.head_id AS person_head_id,
                       (SELECT group_concat(head_id) FROM user_head_scopes s WHERE s.user_id = u.id) AS head_ids
                  FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.role, u.display_name`).all();
  rows = rows.map((r) => ({ ...r, head_ids: r.head_ids ? r.head_ids.split(',').map(Number) : [] }));
  if (req.user.role === 'head_admin') {
    rows = rows.filter((r) => r.id === req.user.id || (r.person_head_id && req.user.headIds.includes(r.person_head_id)));
  }
  res.json(rows);
});

function validateUserRole(actor, role, personId, headIds) {
  if (!ROLES[role]) throw badRequest('VALIDATION', 'Rol no válido.');
  if (actor.role === 'head_admin' && !['leader', 'member'].includes(role)) {
    throw forbidden('Un administrador de cabeza sólo puede crear cuentas de líderes y personas.');
  }
  if (role === 'leader' || role === 'member') {
    const p = personId ? getPerson(personId) : null;
    if (!p) throw badRequest('VALIDATION', 'Debe vincular la cuenta a una persona registrada.');
    if (!canManagePerson(actor, p)) throw forbidden('No administra la cabeza de esa persona.');
    if (role === 'leader' && !p.is_leader) throw badRequest('NOT_LEADER', 'Sólo un líder oficial puede tener una cuenta de líder. Invitar personas no otorga liderazgo.');
    if (role === 'member' && p.is_leader) throw badRequest('VALIDATION', 'Esta persona es líder: use el rol de líder.');
  }
  if (role === 'head_admin' && (!headIds || !headIds.length)) throw badRequest('VALIDATION', 'Asigne al menos una cabeza.');
}

api.post('/users', requireRole('super_admin', 'head_admin'), (req, res) => {
  const username = str(req.body.username, { field: 'usuario', required: true, min: 3, max: 60 });
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw badRequest('VALIDATION', 'El usuario sólo admite letras, números, punto, guion y guion bajo.');
  const password = String(req.body.password ?? '');
  if (password.length < 8) throw badRequest('VALIDATION', 'La contraseña debe tener al menos 8 caracteres.');
  const role = String(req.body.role);
  const personId = intOrNull(req.body.person_id, 'person_id');
  const headIds = Array.isArray(req.body.head_ids) ? req.body.head_ids.map(Number).filter(Boolean) : [];
  validateUserRole(req.user, role, personId, headIds);
  if (q('SELECT 1 FROM users WHERE username = ?').get(username)) throw badRequest('DUPLICATE', 'Ese nombre de usuario ya existe.');
  if (personId && q('SELECT 1 FROM users WHERE person_id = ?').get(personId)) throw badRequest('DUPLICATE', 'Esa persona ya tiene una cuenta.');
  const displayName = str(req.body.display_name, { field: 'nombre', max: 120 }) || (personId ? getPerson(personId).full_name : username);
  const id = tx(() => {
    const r = q('INSERT INTO users (username, display_name, password_hash, role, person_id) VALUES (?,?,?,?,?)')
      .run(username, displayName, hashPassword(password), role, role === 'leader' || role === 'member' ? personId : null);
    const uid = Number(r.lastInsertRowid);
    if (role === 'head_admin') for (const h of headIds) q('INSERT INTO user_head_scopes (user_id, head_id) VALUES (?,?)').run(uid, h);
    return uid;
  });
  audit(req.user, 'user.create', 'user', id, { username, role, person_id: personId, head_ids: headIds }, ip(req));
  res.status(201).json({ id });
});

api.patch('/users/:id', requireRole('super_admin', 'head_admin'), (req, res) => {
  const target = q('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) throw notFound();
  if (req.user.role === 'head_admin') {
    const p = target.person_id ? getPerson(target.person_id) : null;
    assert(p && canManagePerson(req.user, p) && ['leader', 'member'].includes(target.role), 'No puede modificar esta cuenta.');
  }
  const changes = {};
  tx(() => {
    if (req.body.status !== undefined) {
      if (!['active', 'disabled'].includes(req.body.status)) throw badRequest('VALIDATION', 'Estado no válido.');
      if (target.id === req.user.id) throw badRequest('VALIDATION', 'No puede desactivar su propia cuenta.');
      q('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, target.id);
      if (req.body.status === 'disabled') q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      changes.status = req.body.status;
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw badRequest('VALIDATION', 'La contraseña debe tener al menos 8 caracteres.');
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), target.id);
      q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      changes.password = 'changed';
    }
    if (req.body.head_ids !== undefined && req.user.role === 'super_admin' && target.role === 'head_admin') {
      const ids = req.body.head_ids.map(Number).filter(Boolean);
      if (!ids.length) throw badRequest('VALIDATION', 'Asigne al menos una cabeza.');
      q('DELETE FROM user_head_scopes WHERE user_id = ?').run(target.id);
      for (const h of ids) q('INSERT INTO user_head_scopes (user_id, head_id) VALUES (?,?)').run(target.id, h);
      changes.head_ids = ids;
    }
  });
  audit(req.user, 'user.update', 'user', target.id, changes, ip(req));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auditoría e integridad
// ---------------------------------------------------------------------------
api.get('/audit', requireRole('super_admin'), (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('a.action LIKE ?'); params.push(`${req.query.action}%`); }
  if (req.query.entity_id) { where.push('a.entity_id = ?'); params.push(Number(req.query.entity_id)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = q(`SELECT COUNT(*) n FROM audit_log a ${w}`).get(...params).n;
  const rows = q(`SELECT a.*, u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w}
                  ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, rows: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })) });
});

api.get('/admin/integrity', requireRole('super_admin'), (_req, res) => res.json(integrityReport()));

// ---------------------------------------------------------------------------
// Registro público mediante enlace
// ---------------------------------------------------------------------------
const publicLimiter = rateLimit({ windowMs: 10 * 60e3, max: 10, key: (req) => `reg:${req.ip}` });
const lookupLimiter = rateLimit({ windowMs: 60e3, max: 60, key: (req) => `inv:${req.ip}` });

api.get('/public/invite/:token', lookupLimiter, (req, res) => {
  const { link, owner, head, valid, reason } = resolveInvite(req.params.token);
  res.json({
    token: link.token, valid, reason,
    inviter: { name: owner.full_name, is_leader: !!owner.is_leader && link.kind === 'leader' },
    head: { name: head.name, color: head.color },
    requires_approval: !!head.requires_approval,
  });
});

api.post('/public/register/:token', publicLimiter, (req, res) => {
  // Sólo se aceptan los campos del formulario; cabeza, invitador y líder se derivan del token.
  const { full_name, phone, email, document_id, city, consent, website } = req.body || {};
  let result;
  try {
    result = registerViaInvite(req.params.token, { full_name, phone, email, document_id, city, consent, website }, ip(req));
  } catch (e) {
    // No se revela a quién pertenece un dato duplicado en el formulario público.
    if (e instanceof AppError && e.code === 'DUPLICATE') {
      throw new AppError(409, 'DUPLICATE', 'Estos datos ya están registrados. Si cree que es un error, contacte con quien le invitó.', { field: e.extra?.field });
    }
    throw e;
  }
  const { person, owner, head } = result;
  res.status(201).json({
    ok: true, status: person.status, code: person.code,
    inviter: owner.full_name, head: head.name,
    invite_token: person.status === 'active'
      ? q(`SELECT token FROM invite_links WHERE owner_person_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`).get(person.id)?.token ?? null
      : null,
  });
});
