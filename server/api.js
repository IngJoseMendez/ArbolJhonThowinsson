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
  setStatus, updatePersonData, regeneratePersonLink, integrityReport, recountCounters, getPerson, getHead, findDuplicate,
  createRegisterLink, ensureGeneralLink, createOneTimeLink, oneTimeStats, revokeOpenOneTime, issuePanelToken, revokePanelToken, regTypeById,
  headPerson, setHeadRole, recoverableLeader, recoverPanel,
} from './services/people.js';
import { panelData, panelLeaderInvite, panelManifest } from './services/panel.js';
import { treeChildren, treeSubtree, treeChildrenOf, pathToPerson, search, directory, dashboard, branchStats, NODE_SELECT } from './services/queries.js';
import {
  listAreas, getArea, createArea, updateArea, importAreas, pendingGroups, resolvePendingGroup, locationStats, setPersonLocation,
} from './services/geo.js';
import { audit } from './services/audit.js';
import {
  badRequest, notFound, forbidden, str, intOrNull, slugLower, maskPhone, normalizePhone, normalizeDocument, AppError, sha256, normalizeText,
} from './util.js';

export const api = express.Router();
const HEAD_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const ip = (req) => req.ip;
const mapSeq = async (arr, fn) => { const out = []; for (const x of arr) out.push(await fn(x)); return out; };

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------
api.post('/auth/login', rateLimit({ windowMs: 15 * 60e3, max: 20 }), async (req, res) => {
  const username = str(req.body.username, { field: 'usuario', required: true, max: 80 });
  const password = String(req.body.password ?? '');
  const u = await q('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  if (!u || u.status !== 'active' || !verifyPassword(password, u.password_hash)) {
    await audit(null, 'auth.login_failed', 'user', u?.id ?? null, { username }, ip(req));
    throw new AppError(401, 'BAD_CREDENTIALS', 'Usuario o contraseña incorrectos.');
  }
  const { token, expires } = await createSession(u.id);
  setSessionCookie(res, token, expires);
  await audit(u, 'auth.login', 'user', u.id, {}, ip(req));
  res.json({ ok: true });
});

api.post('/auth/logout', async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  const heads = visibleHeadIds(u);
  let person = null;
  if (u.person) {
    const p = await getPerson(u.person.id);
    person = { id: p.id, full_name: p.full_name, code: p.code, is_leader: !!p.is_leader, is_head: !!p.is_head, head_id: p.head_id, status: p.status };
  }
  res.json({
    user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, role_label: ROLES[u.role], head_ids: heads },
    person,
  });
});

api.post('/me/password', requireAuth, rateLimit({ windowMs: 15 * 60e3, max: 10 }), async (req, res) => {
  const u = await q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body.current ?? ''), u.password_hash)) throw badRequest('BAD_PASSWORD', 'La contraseña actual no es correcta.');
  const next = String(req.body.password ?? '');
  if (next.length < 8) throw badRequest('VALIDATION', 'La nueva contraseña debe tener al menos 8 caracteres.');
  await q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
  await q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, sha256(req.sessionToken));
  await audit(req.user, 'user.password_change', 'user', u.id, {}, ip(req));
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

// La cabeza (persona) de cada estructura, si la tiene.
const headCabeza = `LEFT JOIN people c ON c.head_id = h.id AND c.is_head = 1 AND c.status <> 'rejected'`;
const cabezaCols = 'c.id AS cabeza_id, c.full_name AS cabeza_name, c.status AS cabeza_status';

api.get('/heads', requireAuth, async (req, res) => {
  const ids = visibleHeadIds(req.user);
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let rows;
  if (ids === null) rows = await q(`SELECT h.*, ${cabezaCols}, ${headCounts} FROM heads h ${headCabeza} ORDER BY h.status, h.name`).all(since);
  else if (!ids.length) rows = [];
  else rows = await q(`SELECT h.*, ${cabezaCols}, ${headCounts} FROM heads h ${headCabeza} WHERE h.id IN (${ids.map(() => '?').join(',')}) ORDER BY h.status, h.name`).all(since, ...ids);
  // Líderes y personas sólo ven totales de su alcance, no de toda la cabeza.
  if (!isAdmin(req.user)) rows = rows.map((r) => ({ ...r, people: null, leaders: null, pending: null, last30: null }));
  res.json(rows.map((r) => ({ ...r, requires_approval: !!r.requires_approval, person_invites_enabled: !!r.person_invites_enabled, can_manage: canManageHead(req.user, r.id) })));
});

async function headInput(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { field: 'nombre', required: true, min: 2, max: 80 });
  if (!partial || body.description !== undefined) out.description = str(body.description, { field: 'descripción', max: 500 });
  if (!partial || body.region !== undefined) out.region = str(body.region, { field: 'región', max: 80 });
  if (body.color !== undefined || !partial) {
    // Por defecto, el siguiente color libre de la paleta categórica validada.
    const used = new Set((await q('SELECT color FROM heads').all()).map((r) => r.color));
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

api.post('/heads', requireRole('super_admin'), async (req, res) => {
  const d = await headInput(req.body);
  if (await q('SELECT 1 FROM heads WHERE lower(name) = lower(?)').get(d.name)) throw badRequest('DUPLICATE', 'Ya existe una cabeza con ese nombre.');
  let slug = slugLower(d.name);
  for (let i = 2; await q('SELECT 1 FROM heads WHERE slug = ?').get(slug); i++) slug = `${slugLower(d.name)}-${i}`;
  const r = await q(`INSERT INTO heads (name, slug, description, region, color, requires_approval, person_invites_enabled, created_by)
               VALUES (?,?,?,?,?,?,?,?)`).run(d.name, slug, d.description, d.region, d.color, d.requires_approval ?? 0,
    d.person_invites_enabled ?? 1, req.user.id);
  const id = Number(r.lastInsertRowid);
  await audit(req.user, 'head.create', 'head', id, d, ip(req));
  res.status(201).json(await getHead(id));
});

api.get('/heads/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const h = await getHead(id);
  if (!h || !canViewHead(req.user, id)) throw notFound('Cabeza no encontrada.');
  const stats = await dashboard(req.user, { headId: id, days: 60 });
  const sc = scopeSql(req.user, 'l');
  const leaders = (await q(`SELECT l.id, l.full_name, l.leader_code, l.status, l.created_at, l.inviter_id, l.is_head, i.full_name AS inviter_name,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        l.descendant_count AS branch
      FROM people l LEFT JOIN people i ON i.id = l.inviter_id
      WHERE l.head_id = ? AND l.is_leader = 1 AND l.status <> 'rejected' AND ${sc.sql}
      ORDER BY l.is_head DESC, l.depth, l.full_name`).all(id, ...sc.params)).map((l) => ({ ...l, is_head: !!l.is_head }));
  const c = await headPerson(id);
  const cabeza = c && canViewPerson(req.user, { ...c, head_id: id, leader_id: null })
    ? { ...(await q(`SELECT id, code, full_name, leader_code, status, created_at, child_count, descendant_count, panel_viewed_at,
          panel_token_hash IS NOT NULL AS panel_active FROM people WHERE id = ?`).get(c.id)) }
    : null;
  res.json({
    head: { ...h, requires_approval: !!h.requires_approval, person_invites_enabled: !!h.person_invites_enabled },
    can_manage: canManageHead(req.user, id),
    cabeza, stats, leaders,
  });
});

api.patch('/heads/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const h = await getHead(id);
  if (!h) throw notFound();
  assert(canManageHead(req.user, id), 'No administra esta cabeza.');
  const d = await headInput(req.body, true);
  if (d.status && req.user.role !== 'super_admin') throw forbidden('Sólo el administrador general puede archivar cabezas.');
  if (d.name && await q('SELECT 1 FROM heads WHERE lower(name) = lower(?) AND id <> ?').get(d.name, id)) throw badRequest('DUPLICATE', 'Ya existe una cabeza con ese nombre.');
  const keys = Object.keys(d);
  if (keys.length) {
    await q(`UPDATE heads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => d[k]), now(), id);
    await audit(req.user, 'head.update', 'head', id, d, ip(req));
  }
  res.json(await getHead(id));
});

// ---------------------------------------------------------------------------
// Árbol y búsqueda
// ---------------------------------------------------------------------------
api.get('/tree/:headId/children', requireAuth, async (req, res) => {
  const headId = Number(req.params.headId);
  if (!await getHead(headId) || !canViewHead(req.user, headId)) throw notFound('Cabeza no encontrada.');
  const parentId = intOrNull(req.query.parent, 'parent');
  if (parentId) {
    const parent = await getPerson(parentId);
    if (!parent || parent.head_id !== headId || !canViewPerson(req.user, parent)) throw notFound('Nodo no encontrado.');
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const include = intOrNull(req.query.include, 'include');
  const r = await treeChildren(req.user, headId, parentId, { limit, offset, include });
  r.nodes = r.nodes.filter((n) => canViewPerson(req.user, n)).map((n) => ({ ...n, path: undefined }));
  res.json(r);
});

api.get('/tree/path/:personId', requireAuth, async (req, res) => {
  const p = await getPerson(Number(req.params.personId));
  if (!p || p.status === 'rejected' || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  res.json({ head_id: p.head_id, chain: (await pathToPerson(req.user, p)).map((n) => ({ ...n, path: undefined })) });
});

// Rama completa en bloques (para "Expandir todo").
api.get('/tree/:headId/subtree', requireAuth, async (req, res) => {
  const headId = Number(req.params.headId);
  if (!await getHead(headId) || !canViewHead(req.user, headId)) throw notFound('Cabeza no encontrada.');
  const rootId = intOrNull(req.query.root, 'root');
  if (rootId) {
    const root = await getPerson(rootId);
    if (!root || root.head_id !== headId || !canViewPerson(req.user, root)) throw notFound('Nodo no encontrado.');
  } else if ((req.user.role === 'leader' || req.user.role === 'member') && req.user.person?.head_id !== headId) {
    throw notFound('Cabeza no encontrada.');
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 1), 5000);
  const r = await treeSubtree(req.user, headId, rootId, { after: req.query.after || null, limit });
  res.json({ next: r.next, nodes: r.nodes.filter((n) => canViewPerson(req.user, n)).map((n) => ({ ...n, path: undefined })) });
});

// Hijos de varios nodos (restaurar el estado de expansión guardado).
api.post('/tree/:headId/children-batch', requireAuth, async (req, res) => {
  const headId = Number(req.params.headId);
  if (!await getHead(headId) || !canViewHead(req.user, headId)) throw notFound('Cabeza no encontrada.');
  const ids = [...new Set((Array.isArray(req.body.parents) ? req.body.parents : []).map(Number).filter(Number.isInteger))].slice(0, 2000);
  const allowed = [];
  for (const id of ids) {
    const p = await q('SELECT id, head_id, path, leader_id FROM people WHERE id = ?').get(id);
    if (p && p.head_id === headId && canViewPerson(req.user, p)) allowed.push(id);
  }
  const nodes = (await treeChildrenOf(allowed)).filter((n) => canViewPerson(req.user, n)).map((n) => ({ ...n, path: undefined }));
  res.json({ parents: allowed, nodes });
});

api.get('/search', requireAuth, async (req, res) => {
  res.json(await search(req.user, req.query.q, { headId: intOrNull(req.query.head_id, 'head_id') }));
});

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
api.get('/people', requireAuth, async (req, res) => res.json(await directory(req.user, req.query)));

api.get('/people/check-duplicate', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  // Misma normalización que al guardar: sin puntos/espacios ni ceros a la izquierda.
  const document_id = String(req.query.document_id || '').replace(/[.\s-]/g, '').replace(/^0+(?=\d)/, '') || null;
  if (phone.length < 7 && !document_id) return res.json({ duplicate: null });
  const d = await findDuplicate({ phone: phone.length >= 7 ? phone : '__none__', document_id });
  if (!d) return res.json({ duplicate: null });
  const visible = canManageHead(req.user, d.person.head_id);
  res.json({ duplicate: { field: d.field, ...(visible ? d.person : { head_id: null }) } });
});

api.post('/people', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const headId = intOrNull(req.body.head_id, 'head_id');
  if (!headId) throw badRequest('VALIDATION', 'Debe seleccionar la cabeza.', { field: 'head_id' });
  assert(canManageHead(req.user, headId), 'No administra esta cabeza.');
  const regTypeId = intOrNull(req.body.reg_type_id, 'reg_type_id');
  // Un tipo de cabeza registra a la cabeza de la estructura (sólo el administrador general).
  const isHead = !!req.body.is_head || (regTypeId ? (await regTypeById(regTypeId))?.role === 'head' : false);
  if (isHead && req.user.role !== 'super_admin') throw forbidden('Sólo el administrador general registra cabezas.');
  const p = await createPerson({
    data: req.body,
    headId,
    inviterId: intOrNull(req.body.inviter_id, 'inviter_id'),
    isLeader: !!req.body.is_leader,
    isHead,
    leaderOverrideId: intOrNull(req.body.leader_id, 'leader_id'),
    regTypeId,
    method: 'manual',
    user: req.user,
    status: 'active',
    consent: !!req.body.consent,
    reason: req.body.reason ? str(req.body.reason, { field: 'motivo', max: 300 }) : null,
    ip: ip(req),
  });
  res.status(201).json(p);
});

async function loadVisiblePerson(req) {
  const p = await getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  return p;
}

async function linkWithUses(l) {
  if (!l) return null;
  const u = await q(`SELECT COUNT(*) total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) pending, MAX(created_at) last_used
               FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(l.id);
  return { ...l, uses: u.total, pending: u.pending ?? 0, last_used: u.last_used };
}

api.get('/people/:id', requireAuth, async (req, res) => {
  const p = await loadVisiblePerson(req);
  const u = req.user;
  const manage = canManagePerson(u, p);
  const contact = canSeeContact(u, p);
  const head = await getHead(p.head_id);
  const cabeza = await headPerson(p.head_id);
  const leader = p.leader_id ? await q('SELECT id, full_name, leader_code, code, is_head FROM people WHERE id = ?').get(p.leader_id) : null;
  const inviter = p.inviter_id ? await q('SELECT id, full_name, code, is_leader, is_head, leader_code FROM people WHERE id = ?').get(p.inviter_id) : null;
  const registeredBy = p.registered_by_user_id ? await q('SELECT id, display_name, role FROM users WHERE id = ?').get(p.registered_by_user_id) : null;
  const viaLink = p.invite_link_id ? await q('SELECT id, token, kind, owner_person_id FROM invite_links WHERE id = ?').get(p.invite_link_id) : null;
  const invitees = (await q(`${NODE_SELECT} WHERE p.inviter_id = ? AND p.status <> 'rejected' ORDER BY p.created_at LIMIT 200`).all(p.id))
    .map((n) => ({ ...n, is_leader: !!n.is_leader, path: undefined }));
  const isSelf = u.person?.id === p.id;
  const links = (manage || isSelf || (u.role === 'leader' && canViewPerson(u, p)))
    ? await mapSeq(await q('SELECT * FROM invite_links WHERE owner_person_id = ? ORDER BY status, id DESC').all(p.id), linkWithUses) : [];
  const SAFE = new Set(['registered', 'promoted_leader', 'demoted_leader', 'moved', 'moved_head', 'approved', 'leader_changed']);
  const history = (await q(`SELECT h.*, u.display_name AS changed_by_name FROM person_history h LEFT JOIN users u ON u.id = h.changed_by
                     WHERE h.person_id = ? ORDER BY h.id DESC LIMIT 200`).all(p.id))
    .filter((h) => manage || isSelf || SAFE.has(h.change_type))
    .map((h) => ({ ...h, details: JSON.parse(h.details) }));
  const account = manage ? await q('SELECT id, username, role, status, last_login_at FROM users WHERE person_id = ?').get(p.id) : null;
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
    const r = await getPerson(pid);
    if (r) names.people[pid] = canViewPerson(u, r) || r.id === p.inviter_id || r.id === p.leader_id ? r.full_name : 'Persona fuera de su alcance';
  }
  for (const hid of hids) { const r = await getHead(hid); if (r) names.heads[hid] = r.name; }
  res.json({
    person: {
      ...p, is_leader: !!p.is_leader, is_head: !!p.is_head, path: undefined, registration_ip: undefined,
      phone: contact ? p.phone : maskPhone(p.phone), email: contact ? p.email : null,
      document_id: contact ? p.document_id : null, notes: manage ? p.notes : '',
      address: contact ? p.address : null,
    },
    location: await locationOf(p),
    head: {
      id: head.id, name: head.name, color: head.color, person_invites_enabled: !!head.person_invites_enabled,
      cabeza: cabeza ? { id: cabeza.id, full_name: cabeza.full_name, status: cabeza.status } : null,
    },
    leader: leader ? { ...leader, is_head: !!leader.is_head } : null,
    inviter: inviter ? { ...inviter, is_leader: !!inviter.is_leader, is_head: !!inviter.is_head } : null,
    registered_by: registeredBy, via_link: viaLink, invitees, links, history, account, names,
    stats: await branchStats(p),
    chain: (await pathToPerson(u, p)).map((n) => ({ id: n.id, full_name: n.full_name, is_leader: n.is_leader, is_head: n.is_head, code: n.code })),
    permissions: { manage, contact, super: u.role === 'super_admin', self: isSelf },
  });
});

// Cabeza de la estructura: designar a un líder raíz (sus demás líderes raíz pasan a colgar de él) o retirarle el papel.
api.post('/people/:id/head-role', requireRole('super_admin'), async (req, res) => {
  const p = await loadManagedPerson(req);
  res.json(await setHeadRole(p.id, req.body.is_head !== false, req.user, reasonOf(req), ip(req)));
});

const reasonOf = (req, required = false) => {
  const r = str(req.body.reason, { field: 'motivo', max: 300, required });
  return r || null;
};

async function loadManagedPerson(req) {
  const p = await getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  assert(canManagePerson(req.user, p), 'No tiene permisos para modificar a esta persona.');
  return p;
}

api.patch('/people/:id', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  res.json(await updatePersonData(p.id, req.body, req.user, ip(req)));
});

// Panel privado del líder: el enlace secreto sólo se muestra al emitirlo; emitir uno nuevo invalida el anterior.
api.post('/people/:id/panel', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  if (!p.is_leader) throw badRequest('NOT_LEADER', 'El panel de gestión es para líderes.');
  const token = await issuePanelToken(p.id);
  await audit(req.user, 'panel.issue', 'person', p.id, {}, ip(req));
  res.json({ token });
});

api.post('/people/:id/panel/revoke', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  await revokePanelToken(p.id);
  await audit(req.user, 'panel.revoke', 'person', p.id, {}, ip(req));
  res.json({ ok: true });
});

api.post('/people/:id/promote', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  res.json(await promoteToLeader(p.id, req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/demote', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  res.json(await demoteLeader(p.id, req.user, reasonOf(req, true), ip(req)));
});

api.post('/people/:id/leader', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  res.json(await setResponsibleLeader(p.id, intOrNull(req.body.leader_id, 'leader_id'), req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/status', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  const status = String(req.body.status || '');
  res.json(await setStatus(p.id, status, req.user, reasonOf(req, status !== 'active'), ip(req)));
});

api.post('/people/:id/move', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  const newInviterId = intOrNull(req.body.inviter_id, 'inviter_id');
  let newHeadId = intOrNull(req.body.head_id, 'head_id');
  if (newInviterId) {
    const t = await getPerson(newInviterId);
    if (!t) throw badRequest('VALIDATION', 'El nuevo invitador no existe.');
    newHeadId = newHeadId ?? t.head_id;
  }
  newHeadId = newHeadId ?? p.head_id;
  // Mover entre cabezas exige administrar ambas cabezas.
  assert(canManageHead(req.user, newHeadId), 'No administra la cabeza de destino.');
  res.json(await movePerson(p.id, { newInviterId, newHeadId }, req.user, reasonOf(req), ip(req)));
});

api.post('/people/:id/link', requireAuth, async (req, res) => {
  const p = await getPerson(Number(req.params.id));
  if (!p || !canViewPerson(req.user, p)) throw notFound('Persona no encontrada.');
  // La propia persona puede generar su invitación; los administradores, la de cualquiera en su ámbito.
  assert(canManagePerson(req.user, p) || req.user.person?.id === p.id, 'No puede generar invitaciones para esta persona.');
  res.json(await linkWithUses(await regeneratePersonLink(p.id, req.user, ip(req))));
});

// ---------------------------------------------------------------------------
// Líderes
// ---------------------------------------------------------------------------
api.get('/leaders', requireAuth, async (req, res) => {
  const sc = scopeSql(req.user, 'l');
  const params = [...sc.params];
  let extra = '';
  if (req.query.head_id) { extra += ' AND l.head_id = ?'; params.push(Number(req.query.head_id)); }
  if (req.query.q) { extra += ' AND (l.name_key LIKE ? OR l.leader_code LIKE ?)'; params.push(`%${String(req.query.q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`, `%${String(req.query.q).toUpperCase()}%`); }
  const rows = await q(`SELECT l.id, l.code, l.full_name, l.leader_code, l.leader_since, l.status, l.head_id, l.inviter_id, l.created_at, l.city,
        l.is_head = 1 AS is_head,
        h.name AS head_name, h.color AS head_color, i.full_name AS inviter_name, sup.full_name AS supervisor_name,
        (SELECT COUNT(*) FROM people a WHERE a.leader_id = l.id AND a.status <> 'rejected') AS assigned,
        l.descendant_count AS branch,
        l.child_count AS direct,
        (SELECT token FROM invite_links k WHERE k.owner_person_id = l.id AND k.kind = 'leader' AND k.status = 'active' ORDER BY k.id DESC LIMIT 1) AS link_token,
        (SELECT COUNT(*) FROM people r JOIN invite_links k ON k.id = r.invite_link_id WHERE k.owner_person_id = l.id AND k.kind = 'leader' AND r.status <> 'rejected') AS link_uses
      FROM people l JOIN heads h ON h.id = l.head_id LEFT JOIN people i ON i.id = l.inviter_id LEFT JOIN people sup ON sup.id = l.leader_id
      WHERE l.is_leader = 1 AND l.status <> 'rejected' AND ${sc.sql} ${extra}
      ORDER BY h.name, l.is_head DESC, branch DESC, l.full_name LIMIT 500`).all(...params);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Enlaces e invitaciones
// ---------------------------------------------------------------------------
const HEX = /^#[0-9a-fA-F]{6}$/;
const ROLES_TYPE = ['head', 'leader', 'person'];

api.get('/reg-types', requireAuth, async (req, res) => {
  const all = req.query.all === '1' && isAdmin(req.user);
  res.json(await q(`SELECT t.*, (SELECT COUNT(*) FROM people p WHERE p.reg_type_id = t.id AND p.status <> 'rejected') AS people
      FROM reg_types t ${all ? '' : 'WHERE t.active = 1'}
      ORDER BY CASE t.role WHEN 'head' THEN 0 WHEN 'leader' THEN 1 ELSE 2 END, t.builtin DESC, t.name`).all());
});

api.post('/reg-types', requireRole('super_admin'), async (req, res) => {
  const name = str(req.body.name, { field: 'nombre', key: 'name', required: true, min: 2, max: 60 });
  const role = String(req.body.role || '');
  if (!ROLES_TYPE.includes(role)) throw badRequest('VALIDATION', 'Elija si el tipo registra cabezas, líderes o personas.', { field: 'role' });
  const color = String(req.body.color || '');
  if (!HEX.test(color)) throw badRequest('VALIDATION', 'Color no válido.', { field: 'color' });
  const key = normalizeText(name);
  if (await q('SELECT 1 FROM reg_types WHERE name_key = ?').get(key)) throw badRequest('DUPLICATE', 'Ya existe un tipo con ese nombre.', { field: 'name' });
  const r = await q('INSERT INTO reg_types (name, name_key, role, color) VALUES (?,?,?,?)').run(name, key, role, color.toLowerCase());
  await audit(req.user, 'reg_type.create', 'reg_type', Number(r.lastInsertRowid), { name, role, color }, ip(req));
  res.status(201).json(await regTypeById(Number(r.lastInsertRowid)));
});

api.patch('/reg-types/:id', requireRole('super_admin'), async (req, res) => {
  const t = await regTypeById(Number(req.params.id));
  if (!t) throw notFound('Tipo no encontrado.');
  const d = {};
  if (req.body.name !== undefined) {
    d.name = str(req.body.name, { field: 'nombre', key: 'name', required: true, min: 2, max: 60 });
    const other = await q('SELECT id FROM reg_types WHERE name_key = ? AND id <> ?').get(normalizeText(d.name), t.id);
    if (other) throw badRequest('DUPLICATE', 'Ya existe un tipo con ese nombre.', { field: 'name' });
  }
  if (req.body.color !== undefined) {
    if (!HEX.test(String(req.body.color))) throw badRequest('VALIDATION', 'Color no válido.', { field: 'color' });
    d.color = String(req.body.color).toLowerCase();
  }
  if (req.body.active !== undefined) {
    if (t.builtin && !req.body.active) throw badRequest('BUILTIN', 'Los tipos base (Cabeza, Líder, Persona) no se pueden desactivar.');
    d.active = req.body.active ? 1 : 0;
  }
  // El rol no se cambia: las personas ya registradas con el tipo quedarían incoherentes.
  if (Object.keys(d).length) {
    await q(`UPDATE reg_types SET name = COALESCE(?, name), name_key = COALESCE(?, name_key), color = COALESCE(?, color),
        active = COALESCE(?, active), updated_at = ? WHERE id = ?`)
      .run(d.name ?? null, d.name ? normalizeText(d.name) : null, d.color ?? null, d.active ?? null, now(), t.id);
    await audit(req.user, 'reg_type.update', 'reg_type', t.id, d, ip(req));
  }
  res.json(await regTypeById(t.id));
});

api.post('/links', requireRole('super_admin', 'head_admin'), async (req, res) => {
  if (req.body.head_id && !canManageHead(req.user, Number(req.body.head_id))) throw forbidden('No administra esta cabeza.');
  res.status(201).json(await createRegisterLink(req.body, req.user, ip(req)));
});

// Enlace general de un tipo (se crea la primera vez y luego se reutiliza): tarjetas «enviar por WhatsApp».
api.post('/links/general', requireRole('super_admin', 'head_admin'), async (req, res) => {
  if (req.body.head_id && !canManageHead(req.user, Number(req.body.head_id))) throw forbidden('No administra esta cabeza.');
  const l = await ensureGeneralLink(req.body, req.user, ip(req));
  const uses = (await q(`SELECT COUNT(*) AS n FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(l.id)).n;
  res.json({ ...l, uses });
});

// Enlaces de un solo uso para cabezas y líderes: uno nuevo por cada envío.
const oneTimeLimiter = rateLimit({ windowMs: 60e3, max: 60, key: (req) => `onetime:${req.user?.id}` });
const oneTimeScope = async (req) => {
  const type = await regTypeById(Number(req.body?.reg_type_id ?? req.query.reg_type_id));
  if (!type || type.role === 'person') throw badRequest('VALIDATION', 'Tipo de registro no válido.', { field: 'reg_type_id' });
  if (type.role === 'head' && req.user.role !== 'super_admin') throw forbidden('Sólo el administrador general registra cabezas.');
  const headId = type.role === 'head' ? null : Number(req.body?.head_id ?? req.query.head_id) || null;
  if (type.role === 'leader' && (!headId || !canManageHead(req.user, headId))) throw forbidden('No administra esta cabeza.');
  return { type, headId };
};
api.post('/links/one-time', requireRole('super_admin', 'head_admin'), oneTimeLimiter, async (req, res) => {
  const { type, headId } = await oneTimeScope(req);
  const l = await createOneTimeLink({ reg_type_id: type.id, head_id: headId }, req.user, ip(req));
  res.status(201).json({ ...l, stats: await oneTimeStats(type.id, headId) });
});
api.get('/links/one-time/stats', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const { type, headId } = await oneTimeScope(req);
  res.json(await oneTimeStats(type.id, headId));
});
api.post('/links/one-time/revoke-open', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const { type, headId } = await oneTimeScope(req);
  res.json(await revokeOpenOneTime(type.id, headId, req.user, ip(req)));
});

api.get('/links', requireAuth, async (req, res) => {
  // Los enlaces de registro pueden no tener dueño: su cabeza es k.head_id (o ninguna, si registran cabezas nuevas).
  const admin = isAdmin(req.user);
  const sc = admin ? scopeSql(req.user, 'x') : scopeSql(req.user, 'o');
  const params = [...sc.params];
  const where = [sc.sql];
  if (!admin) where.push("k.kind <> 'register'");
  if (req.query.head_id) { where.push('x.head_id = ?'); params.push(Number(req.query.head_id)); }
  if (req.query.kind) { where.push('k.kind = ?'); params.push(String(req.query.kind)); }
  if (req.query.reg_type_id) { where.push('k.reg_type_id = ?'); params.push(Number(req.query.reg_type_id)); }
  if (req.query.status) { where.push('k.status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) {
    where.push('(o.name_key LIKE ? OR k.token LIKE ? OR lower(k.label) LIKE ?)');
    params.push(`%${String(req.query.q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`, `%${String(req.query.q).toUpperCase()}%`,
      `%${String(req.query.q).toLowerCase()}%`);
  }
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const base = `FROM invite_links k LEFT JOIN people o ON o.id = k.owner_person_id
                CROSS JOIN LATERAL (SELECT COALESCE(k.head_id, o.head_id) AS head_id) x
                LEFT JOIN heads h ON h.id = x.head_id LEFT JOIN reg_types rt ON rt.id = k.reg_type_id
                LEFT JOIN users du ON du.id = k.disabled_by WHERE ${where.join(' AND ')}`;
  const total = (await q(`SELECT COUNT(*) n ${base}`).get(...params)).n;
  const rows = await q(`SELECT k.*, o.full_name AS owner_name, o.code AS owner_code, o.is_leader AS owner_is_leader, o.status AS owner_status,
        x.head_id, h.name AS head_name, h.color AS head_color, du.display_name AS disabled_by_name,
        rt.name AS type_name, rt.color AS type_color, rt.role AS type_role,
        (SELECT COUNT(*) FROM people r WHERE r.invite_link_id = k.id AND r.status <> 'rejected') AS uses,
        (SELECT COUNT(*) FROM people r WHERE r.invite_link_id = k.id AND r.status = 'pending') AS pending,
        (SELECT MAX(created_at) FROM people r WHERE r.invite_link_id = k.id) AS last_used
      ${base} ORDER BY k.status, k.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({
    total, page, pageSize,
    rows: rows.map((r) => ({
      ...r, owner_is_leader: !!r.owner_is_leader,
      can_manage: r.head_id ? canManageHead(req.user, r.head_id) : req.user.role === 'super_admin',
    })),
  });
});

async function loadManagedLink(req) {
  const l = await q(`SELECT k.*, COALESCE(k.head_id, o.head_id) AS scope_head_id FROM invite_links k
      LEFT JOIN people o ON o.id = k.owner_person_id WHERE k.id = ?`).get(Number(req.params.id));
  if (!l) throw notFound('Enlace no encontrado.');
  assert(l.scope_head_id ? canManageHead(req.user, l.scope_head_id) : req.user.role === 'super_admin', 'No administra la cabeza de este enlace.');
  return l;
}

api.post('/links/:id/disable', requireAuth, async (req, res) => {
  const l = await loadManagedLink(req);
  const reason = reasonOf(req, true);
  await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = ? WHERE id = ?`)
    .run(now(), req.user.id, reason, l.id);
  await audit(req.user, 'link.disable', 'invite_link', l.id, { token: l.token, reason }, ip(req));
  res.json({ ok: true });
});

api.post('/links/:id/enable', requireAuth, async (req, res) => {
  const l = await loadManagedLink(req);
  if (l.one_time) throw badRequest('ONE_TIME', 'Un enlace de un solo uso no se puede reactivar: genere uno nuevo.');
  if (l.kind === 'register') {
    await q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
    await audit(req.user, 'link.enable', 'invite_link', l.id, { token: l.token }, ip(req));
    return res.json({ ok: true });
  }
  const owner = await getPerson(l.owner_person_id);
  if (owner.status !== 'active') throw badRequest('NOT_ACTIVE', 'El propietario del enlace no está activo.');
  if (l.kind === 'leader' && !owner.is_leader) throw badRequest('NOT_LEADER', 'El propietario ya no es líder.');
  const other = await q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = ? AND status = 'active' AND id <> ?`).get(owner.id, l.kind, l.id);
  if (other) throw badRequest('ALREADY_ACTIVE', 'La persona ya tiene otro enlace activo de este tipo. Desactívelo primero.');
  await q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
  await audit(req.user, 'link.enable', 'invite_link', l.id, { token: l.token }, ip(req));
  res.json({ ok: true });
});

api.patch('/links/:id', requireAuth, async (req, res) => {
  const l = await loadManagedLink(req);
  if (l.one_time) throw badRequest('ONE_TIME', 'Un enlace de un solo uso no admite cambiar sus límites.');
  const maxUses = req.body.max_uses === null || req.body.max_uses === '' ? null : intOrNull(req.body.max_uses, 'max_uses');
  let expires = req.body.expires_at || null;
  if (expires && Number.isNaN(Date.parse(expires))) throw badRequest('VALIDATION', 'Fecha de caducidad no válida.');
  if (expires) expires = new Date(expires).toISOString();
  await q('UPDATE invite_links SET max_uses = ?, expires_at = ? WHERE id = ?').run(maxUses, expires, l.id);
  await audit(req.user, 'link.update', 'invite_link', l.id, { max_uses: maxUses, expires_at: expires }, ip(req));
  res.json({ ok: true });
});

api.get('/pending', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const sc = scopeSql(req.user);
  const rows = await q(`SELECT p.id, p.code, p.full_name, p.phone, p.city, p.created_at, p.head_id, h.name AS head_name, h.color AS head_color,
        i.full_name AS inviter_name, i.id AS inviter_id, l.full_name AS leader_name, k.token AS link_token, k.kind AS link_kind
      FROM people p JOIN heads h ON h.id = p.head_id LEFT JOIN people i ON i.id = p.inviter_id LEFT JOIN people l ON l.id = p.leader_id
      LEFT JOIN invite_links k ON k.id = p.invite_link_id
      WHERE p.status = 'pending' AND ${sc.sql} ORDER BY p.created_at LIMIT 500`).all(...sc.params);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------
api.get('/stats/dashboard', requireAuth, async (req, res) => {
  const headId = intOrNull(req.query.head_id, 'head_id');
  if (headId && !canViewHead(req.user, headId)) throw notFound();
  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 730);
  res.json(await dashboard(req.user, { headId, days }));
});

// ---------------------------------------------------------------------------
// Usuarios y roles
// ---------------------------------------------------------------------------
api.get('/users', requireRole('super_admin', 'head_admin'), async (req, res) => {
  let rows = await q(`SELECT u.id, u.username, u.display_name, u.role, u.status, u.person_id, u.created_at, u.last_login_at,
                       p.full_name AS person_name, p.head_id AS person_head_id,
                       (SELECT string_agg(head_id::text, ',') FROM user_head_scopes s WHERE s.user_id = u.id) AS head_ids
                  FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.role, u.display_name`).all();
  rows = rows.map((r) => ({ ...r, head_ids: r.head_ids ? r.head_ids.split(',').map(Number) : [] }));
  if (req.user.role === 'head_admin') {
    rows = rows.filter((r) => r.id === req.user.id || (r.person_head_id && req.user.headIds.includes(r.person_head_id)));
  }
  res.json(rows);
});

async function validateUserRole(actor, role, personId, headIds) {
  if (!ROLES[role]) throw badRequest('VALIDATION', 'Rol no válido.');
  if (actor.role === 'head_admin' && !['leader', 'member'].includes(role)) {
    throw forbidden('Un administrador de cabeza sólo puede crear cuentas de líderes y personas.');
  }
  if (role === 'leader' || role === 'member') {
    const p = personId ? await getPerson(personId) : null;
    if (!p) throw badRequest('VALIDATION', 'Debe vincular la cuenta a una persona registrada.');
    if (!canManagePerson(actor, p)) throw forbidden('No administra la cabeza de esa persona.');
    if (role === 'leader' && !p.is_leader) throw badRequest('NOT_LEADER', 'Sólo un líder oficial puede tener una cuenta de líder. Invitar personas no otorga liderazgo.');
    if (role === 'member' && p.is_leader) throw badRequest('VALIDATION', 'Esta persona es líder: use el rol de líder.');
  }
  if (role === 'head_admin' && (!headIds || !headIds.length)) throw badRequest('VALIDATION', 'Asigne al menos una cabeza.');
}

api.post('/users', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const username = str(req.body.username, { field: 'usuario', required: true, min: 3, max: 60 });
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw badRequest('VALIDATION', 'El usuario sólo admite letras, números, punto, guion y guion bajo.');
  const password = String(req.body.password ?? '');
  if (password.length < 8) throw badRequest('VALIDATION', 'La contraseña debe tener al menos 8 caracteres.');
  const role = String(req.body.role);
  const personId = intOrNull(req.body.person_id, 'person_id');
  const headIds = Array.isArray(req.body.head_ids) ? req.body.head_ids.map(Number).filter(Boolean) : [];
  await validateUserRole(req.user, role, personId, headIds);
  if (await q('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username)) throw badRequest('DUPLICATE', 'Ese nombre de usuario ya existe.');
  if (personId && await q('SELECT 1 FROM users WHERE person_id = ?').get(personId)) throw badRequest('DUPLICATE', 'Esa persona ya tiene una cuenta.');
  const displayName = str(req.body.display_name, { field: 'nombre', max: 120 }) || (personId ? (await getPerson(personId)).full_name : username);
  const id = await tx(async () => {
    const r = await q('INSERT INTO users (username, display_name, password_hash, role, person_id) VALUES (?,?,?,?,?)')
      .run(username, displayName, hashPassword(password), role, role === 'leader' || role === 'member' ? personId : null);
    const uid = Number(r.lastInsertRowid);
    if (role === 'head_admin') for (const h of headIds) await q('INSERT INTO user_head_scopes (user_id, head_id) VALUES (?,?)').run(uid, h);
    return uid;
  });
  await audit(req.user, 'user.create', 'user', id, { username, role, person_id: personId, head_ids: headIds }, ip(req));
  res.status(201).json({ id });
});

api.patch('/users/:id', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const target = await q('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) throw notFound();
  if (req.user.role === 'head_admin') {
    const p = target.person_id ? await getPerson(target.person_id) : null;
    assert(p && canManagePerson(req.user, p) && ['leader', 'member'].includes(target.role), 'No puede modificar esta cuenta.');
  }
  const changes = {};
  await tx(async () => {
    if (req.body.status !== undefined) {
      if (!['active', 'disabled'].includes(req.body.status)) throw badRequest('VALIDATION', 'Estado no válido.');
      if (target.id === req.user.id) throw badRequest('VALIDATION', 'No puede desactivar su propia cuenta.');
      await q('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, target.id);
      if (req.body.status === 'disabled') await q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      changes.status = req.body.status;
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw badRequest('VALIDATION', 'La contraseña debe tener al menos 8 caracteres.');
      await q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), target.id);
      await q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      changes.password = 'changed';
    }
    if (req.body.head_ids !== undefined && req.user.role === 'super_admin' && target.role === 'head_admin') {
      const ids = req.body.head_ids.map(Number).filter(Boolean);
      if (!ids.length) throw badRequest('VALIDATION', 'Asigne al menos una cabeza.');
      await q('DELETE FROM user_head_scopes WHERE user_id = ?').run(target.id);
      for (const h of ids) await q('INSERT INTO user_head_scopes (user_id, head_id) VALUES (?,?)').run(target.id, h);
      changes.head_ids = ids;
    }
  });
  await audit(req.user, 'user.update', 'user', target.id, changes, ip(req));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Catálogo geográfico y ubicación de personas
// ---------------------------------------------------------------------------
async function locationOf(p) {
  const name = async (id) => (id ? (await getArea(id)) : null);
  const [l, c, b] = [await name(p.geo_localidad_id), await name(p.geo_comuna_id), await name(p.geo_barrio_id)];
  return {
    status: p.geo_status,
    localidad: l ? { id: l.id, name: l.name, alias: l.alias } : p.geo_localidad_text ? { manual: p.geo_localidad_text } : null,
    comuna: c ? { id: c.id, name: c.name, alias: c.alias, kind: c.kind } : p.geo_comuna_text ? { manual: p.geo_comuna_text } : null,
    barrio: b ? { id: b.id, name: b.name, kind: b.kind } : p.geo_barrio_text ? { manual: p.geo_barrio_text } : null,
  };
}

const geoLimiter = rateLimit({ windowMs: 60e3, max: 240, key: (req) => `geo:${req.ip}` });
// Lectura del catálogo: pública porque la usa el formulario de registro por enlace (no contiene datos personales).
api.get('/geo/areas', geoLimiter, async (req, res) => {
  const level = ['localidad', 'comuna', 'barrio'].includes(req.query.level) ? req.query.level : null;
  const parentId = intOrNull(req.query.parent_id, 'parent_id');
  // localidad_id con level=barrio: todos los barrios y veredas de la localidad (formulario sin comuna).
  const localidadId = level === 'barrio' ? intOrNull(req.query.localidad_id, 'localidad_id') : null;
  const allBarrios = level === 'barrio' && req.query.todos === '1';
  if (level && level !== 'localidad' && !parentId && !localidadId && !allBarrios && !req.user) throw badRequest('VALIDATION', 'Indique el nivel superior.');
  const all = req.query.all === '1' && req.user?.role === 'super_admin';
  res.json(await listAreas({ level, parentId, localidadId, allBarrios, term: String(req.query.q || '').slice(0, 60), includeInactive: all, limit: all ? 20000 : 1000 }));
});

api.post('/geo/areas', requireRole('super_admin'), async (req, res) => res.status(201).json(await createArea(req.body, req.user, ip(req))));
api.patch('/geo/areas/:id', requireRole('super_admin'), async (req, res) => res.json(await updateArea(Number(req.params.id), req.body, req.user, ip(req))));
api.post('/geo/import', requireRole('super_admin'), async (req, res) => res.json(await importAreas(req.body.rows, req.user, ip(req))));

api.get('/geo/stats', requireAuth, async (req, res) => {
  const headId = intOrNull(req.query.head_id, 'head_id');
  if (headId && !canViewHead(req.user, headId)) throw notFound();
  res.json(await locationStats(scopeSql(req.user), headId));
});

api.get('/geo/pending', requireRole('super_admin', 'head_admin'), async (req, res) => {
  res.json(await pendingGroups(scopeSql(req.user)));
});

api.post('/geo/pending/resolve', requireRole('super_admin', 'head_admin'), async (req, res) => {
  const g = req.body.group || {};
  const group = {
    geo_localidad_id: intOrNull(g.geo_localidad_id, 'geo_localidad_id'), geo_comuna_id: intOrNull(g.geo_comuna_id, 'geo_comuna_id'),
    geo_localidad_text: g.geo_localidad_text ?? null, geo_comuna_text: g.geo_comuna_text ?? null, geo_barrio_text: g.geo_barrio_text ?? null,
  };
  if (!group.geo_localidad_text && !group.geo_comuna_text && !group.geo_barrio_text) throw badRequest('VALIDATION', 'Grupo no válido.');
  res.json(await resolvePendingGroup(group, req.body.target, scopeSql(req.user), req.user, ip(req)));
});

api.post('/people/:id/location', requireAuth, async (req, res) => {
  const p = await loadManagedPerson(req);
  await setPersonLocation(p.id, req.body.location, req.user, reasonOf(req), ip(req));
  res.json({ location: await locationOf(await getPerson(p.id)) });
});

// ---------------------------------------------------------------------------
// Auditoría e integridad
// ---------------------------------------------------------------------------
api.get('/audit', requireRole('super_admin'), async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('a.action LIKE ?'); params.push(`${req.query.action}%`); }
  if (req.query.entity_id) { where.push('a.entity_id = ?'); params.push(Number(req.query.entity_id)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await q(`SELECT COUNT(*) n FROM audit_log a ${w}`).get(...params)).n;
  const rows = await q(`SELECT a.*, u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w}
                  ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, rows: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })) });
});

api.get('/admin/integrity', requireRole('super_admin'), async (_req, res) => res.json(await integrityReport()));
api.post('/admin/recount', requireRole('super_admin'), async (req, res) => res.json(await recountCounters(req.user, ip(req))));

// ---------------------------------------------------------------------------
// Panel público de solo lectura del líder (enlace secreto + PIN)
// ---------------------------------------------------------------------------
const panelLimiter = rateLimit({ windowMs: 60e3, max: 60, key: (req) => `panel:${req.ip}` });
api.post('/public/panel/:token', panelLimiter, async (req, res) => {
  res.json(await panelData(req.params.token, req.body?.pin, { q: String(req.body?.q || '').slice(0, 60), page: req.body?.page }));
});

// La cabeza invita a un líder desde su panel: un enlace nuevo de un solo uso por envío.
const headInviteLimiter = rateLimit({ windowMs: 10 * 60e3, max: 30, key: (req) => `head-invite:${req.ip}` });
api.post('/public/panel/:token/leader-invite', headInviteLimiter, async (req, res) => {
  res.status(201).json(await panelLeaderInvite(req.params.token, req.body?.pin, ip(req)));
});

// Manifiesto de la app instalable de un panel (al instalarla, abre directo el panel).
api.get('/public/manifest', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.send(JSON.stringify(panelManifest(String(req.query.start || ''))));
});

// ---------------------------------------------------------------------------
// Registro público mediante enlace
// ---------------------------------------------------------------------------
const publicLimiter = rateLimit({ windowMs: 10 * 60e3, max: 10, key: (req) => `reg:${req.ip}` });
const lookupLimiter = rateLimit({ windowMs: 60e3, max: 60, key: (req) => `inv:${req.ip}` });

const firstName = (p) => (p.first_names || p.full_name || '').split(' ')[0];

/**
 * Cómo se presenta públicamente una estructura: por el nombre de su cabeza (una persona), nunca con el prefijo
 * interno del tipo («Cabeza Juan Pérez»). Si la estructura no tiene cabeza, por su nombre.
 */
async function publicHead(head) {
  if (!head) return { head: null, cabeza: null };
  const c = await headPerson(head.id);
  const cabeza = c && c.status === 'active' ? { name: c.full_name, first_name: firstName(c) } : null;
  return { head: { name: head.name, color: head.color, display_name: cabeza?.name || head.name }, cabeza };
}

api.get('/public/invite/:token', lookupLimiter, async (req, res) => {
  const { link, owner, head, type, role, valid, reason } = await resolveInvite(req.params.token);
  const pub = await publicHead(head);
  res.json({
    token: link.token, valid, reason, role,
    type: { name: type.name, color: type.color, role: type.role },
    label: link.label || null,
    inviter: owner ? {
      name: owner.full_name, first_name: firstName(owner),
      is_leader: !!owner.is_leader && link.kind !== 'person', is_head: !!owner.is_head && link.kind !== 'person',
    } : null,
    ...pub,
    requires_approval: role !== 'head' && !!head?.requires_approval,
    // Enlace de un solo uso ya usado por un líder o una cabeza: puede volver a su panel con su cédula y su celular.
    recoverable: !valid && !!(await recoverableLeader(link)),
  });
});

// Volver al panel con el enlace de registro ya usado (si se perdió el enlace del panel o se recargó la página).
const recoverLimiter = rateLimit({ windowMs: 10 * 60e3, max: 20, key: (req) => `recover:${req.ip}` });
api.post('/public/recover/:token', recoverLimiter, async (req, res) => {
  res.json(await recoverPanel(req.params.token, req.body || {}, ip(req)));
});

api.post('/public/register/:token', publicLimiter, async (req, res) => {
  // Sólo se aceptan los campos del formulario; cabeza, invitador y líder se derivan del token.
  const { full_name, first_names, last_names, document_id, address, phone, email, location, supports, consent, website } = req.body || {};
  let result;
  try {
    result = await registerViaInvite(req.params.token, { full_name, first_names, last_names, document_id, address, phone, email, location, supports, consent, website }, ip(req));
  } catch (e) {
    // No se revela a quién pertenece un dato duplicado en el formulario público.
    if (e instanceof AppError && e.code === 'DUPLICATE') {
      throw new AppError(409, 'DUPLICATE', 'Estos datos ya están registrados. Si cree que es un error, contacte con quien le invitó.', { field: e.extra?.field });
    }
    throw e;
  }
  const { person, owner, head, type, role, panelToken } = result;
  const pub = await publicHead(head);
  res.status(201).json({
    ok: true, status: person.status, code: person.code, role, is_leader: !!person.is_leader, is_head: !!person.is_head,
    leader_code: person.leader_code, first_name: firstName(person), full_name: person.full_name, created_at: person.created_at,
    type: { name: type.name, color: type.color },
    inviter: owner?.full_name ?? null, head: head.name, head_display: pub.head.display_name,
    cabeza: person.is_head ? null : pub.cabeza?.name ?? null,
    invite_token: person.status === 'active'
      ? (await q(`SELECT token FROM invite_links WHERE owner_person_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`).get(person.id))?.token ?? null
      : null,
    // Enlace secreto del panel de gestión (sólo líderes). Se muestra una única vez.
    panel_token: panelToken,
  });
});
