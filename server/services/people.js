// Reglas de negocio de personas, líderes, árbol de invitación y enlaces.
import { q, tx, now, pathUpper } from '../db.js';
import {
  badRequest, conflict, notFound, forbidden, normalizeText, slugUpper, randomCode,
  validatePhone, validateEmail, normalizeDocument, str,
} from '../util.js';
import { audit, history } from './audit.js';

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

function tokenTaken(token) {
  return !!(q('SELECT 1 FROM invite_links WHERE token = ?').get(token)
    || q('SELECT 1 FROM people WHERE leader_code = ?').get(token));
}

/** LID-JUAN-PEREZ, LID-JUAN-PEREZ-2, ... (único aunque haya homónimos). */
export function generateLeaderCode(fullName) {
  const base = `LID-${slugUpper(fullName)}`;
  if (!tokenTaken(base)) return base;
  for (let i = 2; ; i++) {
    const c = `${base}-${i}`;
    if (!tokenTaken(c)) return c;
  }
}

function generatePersonCode() {
  for (;;) {
    const c = `PER-${randomCode(6)}`;
    if (!q('SELECT 1 FROM people WHERE code = ?').get(c)) return c;
  }
}

/** Invitación personal: INV-MARIA-GOMEZ-7KQ3 (sufijo aleatorio: no adivinable). */
function generatePersonInviteToken(fullName) {
  const base = `INV-${slugUpper(fullName, 2)}`;
  for (;;) {
    const c = `${base}-${randomCode(4)}`;
    if (!tokenTaken(c)) return c;
  }
}

// ---------------------------------------------------------------------------
// Consultas auxiliares
// ---------------------------------------------------------------------------

export function getPerson(id) {
  return q('SELECT * FROM people WHERE id = ?').get(id);
}

export function getHead(id) {
  return q('SELECT * FROM heads WHERE id = ?').get(id);
}

export const ancestorIds = (path) => path.split('/').filter(Boolean).map(Number);

/** Líder más cercano por encima de una ruta (excluyendo al propio nodo final si excludeSelf). */
export function nearestLeaderFromPath(path, excludeSelf = true) {
  const ids = ancestorIds(path);
  if (excludeSelf) ids.pop();
  if (!ids.length) return null;
  const row = q(`SELECT id FROM people WHERE id IN (${ids.map(() => '?').join(',')}) AND is_leader = 1
                  ORDER BY depth DESC LIMIT 1`).get(...ids);
  return row ? row.id : null;
}

function validatePersonData(data) {
  const full_name = str(data.full_name, { field: 'nombre completo', required: true, min: 3, max: 120 });
  if (!/\p{L}/u.test(full_name)) throw badRequest('VALIDATION', 'El nombre no es válido.', { field: 'full_name' });
  return {
    full_name: full_name.replace(/\s+/g, ' '),
    phone: validatePhone(data.phone),
    email: validateEmail(data.email),
    document_id: normalizeDocument(data.document_id),
    city: str(data.city, { field: 'ciudad / municipio', max: 80 }),
    notes: str(data.notes, { field: 'observaciones', max: 500 }),
  };
}

/** Detecta duplicados por teléfono o documento (en todas las cabezas). */
export function findDuplicate({ phone, document_id }, excludeId = null) {
  const byPhone = q(`SELECT id, code, full_name, head_id FROM people WHERE phone = ? AND status <> 'rejected' AND id IS NOT ?`)
    .get(phone, excludeId);
  if (byPhone) return { field: 'phone', person: byPhone };
  if (document_id) {
    const byDoc = q(`SELECT id, code, full_name, head_id FROM people WHERE document_id = ? AND status <> 'rejected' AND id IS NOT ?`)
      .get(document_id, excludeId);
    if (byDoc) return { field: 'document_id', person: byDoc };
  }
  return null;
}

function assertNoDuplicate(data, excludeId = null) {
  const dup = findDuplicate(data, excludeId);
  if (dup) {
    const what = dup.field === 'phone' ? 'teléfono' : 'documento';
    throw conflict('DUPLICATE', `Ya existe una persona registrada con ese ${what}.`, {
      field: dup.field, existing: { id: dup.person.id, code: dup.person.code, head_id: dup.person.head_id },
    });
  }
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

function createLink(person, kind, userId) {
  const token = kind === 'leader' ? person.leader_code : generatePersonInviteToken(person.full_name);
  const r = q('INSERT INTO invite_links (token, kind, owner_person_id, created_by) VALUES (?, ?, ?, ?)')
    .run(token, kind, person.id, userId ?? null);
  return Number(r.lastInsertRowid);
}

function activeLink(personId, kind) {
  return q(`SELECT * FROM invite_links WHERE owner_person_id = ? AND kind = ? AND status = 'active' ORDER BY id DESC LIMIT 1`)
    .get(personId, kind);
}

/** Garantiza que una persona activa tenga su invitación personal (si la cabeza lo permite). */
function ensurePersonLink(person, userId) {
  const head = getHead(person.head_id);
  if (!head.person_invites_enabled || person.is_leader || person.status !== 'active') return null;
  // Se reactiva el último enlace suspendido automáticamente antes de crear uno nuevo.
  if (activeLink(person.id, 'person')) return null;
  const auto = q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = 'person' AND status = 'disabled'
                   AND disabled_reason = 'auto:person_inactive' ORDER BY id DESC LIMIT 1`).get(person.id);
  if (auto) {
    q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(auto.id);
    return auto.id;
  }
  return createLink(person, 'person', userId);
}

/** Resuelve un token público. Toda la información estructural sale de la BD, nunca de la URL. */
export function resolveInvite(rawToken) {
  const token = String(rawToken ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,80}$/.test(token)) throw notFound('El enlace de invitación no es válido.');
  const link = q('SELECT * FROM invite_links WHERE token = ?').get(token);
  if (!link) throw notFound('El enlace de invitación no es válido.');
  const owner = getPerson(link.owner_person_id);
  const head = getHead(owner.head_id);
  let reason = null;
  if (link.status !== 'active') reason = 'Este enlace fue desactivado.';
  else if (link.expires_at && link.expires_at < now()) reason = 'Este enlace ha caducado.';
  else if (owner.status !== 'active') reason = 'Este enlace ya no está disponible.';
  else if (head.status !== 'active') reason = 'Este enlace ya no está disponible.';
  else if (link.kind === 'leader' && !owner.is_leader) reason = 'Este enlace ya no está disponible.';
  else if (link.max_uses != null) {
    const used = q(`SELECT COUNT(*) n FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(link.id).n;
    if (used >= link.max_uses) reason = 'Este enlace alcanzó su límite de registros.';
  }
  return { link, owner, head, valid: !reason, reason };
}

// ---------------------------------------------------------------------------
// Alta de personas
// ---------------------------------------------------------------------------

/**
 * Crea una persona respetando todas las reglas de pertenencia, responsabilidad e invitación.
 * opts: { data, headId, inviterId, isLeader, leaderOverrideId, method, user, linkId, status, ip, reason }
 */
export function createPerson(opts) {
  return tx(() => {
    const { headId, inviterId = null, isLeader = false, leaderOverrideId = null, method, user = null, linkId = null, ip = null } = opts;
    const data = validatePersonData(opts.data || {});
    const head = getHead(headId);
    if (!head) throw badRequest('VALIDATION', 'Debe seleccionar una cabeza válida.', { field: 'head_id' });
    if (head.status !== 'active') throw badRequest('HEAD_ARCHIVED', 'La cabeza está archivada y no admite registros.');

    let inviter = null;
    if (inviterId) {
      inviter = getPerson(inviterId);
      if (!inviter) throw badRequest('VALIDATION', 'La persona que invita no existe.', { field: 'inviter_id' });
      if (inviter.head_id !== head.id) {
        throw badRequest('INVITER_OTHER_HEAD', 'La persona que invita pertenece a otra cabeza. Una persona no puede pertenecer a dos cabezas.', { field: 'inviter_id' });
      }
      if (inviter.status !== 'active') throw badRequest('INVITER_INACTIVE', 'La persona que invita no está activa.', { field: 'inviter_id' });
    } else if (!isLeader) {
      throw badRequest('INVITER_REQUIRED', 'Debe indicar quién invitó a la persona. Sólo un líder puede colgar directamente de la cabeza.', { field: 'inviter_id' });
    }

    assertNoDuplicate(data);

    // Responsabilidad organizativa.
    let leaderId = null;
    let leaderMode = 'auto';
    if (leaderOverrideId) {
      const l = getPerson(leaderOverrideId);
      if (!l || !l.is_leader || l.head_id !== head.id || l.status === 'rejected') {
        throw badRequest('LEADER_INVALID', 'El líder responsable debe ser un líder oficial de la misma cabeza.', { field: 'leader_id' });
      }
      leaderId = l.id;
      leaderMode = 'manual';
    } else if (inviter) {
      leaderId = inviter.is_leader ? inviter.id : nearestLeaderFromPath(inviter.path, false);
    }

    const status = opts.status || 'active';
    const code = generatePersonCode();
    const leaderCode = isLeader ? generateLeaderCode(data.full_name) : null;
    const ts = now();
    const r = q(`INSERT INTO people (code, full_name, name_key, phone, email, document_id, city, notes, head_id, inviter_id,
                   leader_id, leader_mode, is_leader, leader_code, leader_since, registration_method, registered_by_user_id,
                   invite_link_id, status, path, depth, consent_at, registration_ip, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, data.full_name, normalizeText(data.full_name), data.phone, data.email, data.document_id, data.city, data.notes,
      head.id, inviter?.id ?? null, leaderId, leaderMode, isLeader ? 1 : 0, leaderCode, isLeader ? ts : null,
      method, method === 'manual' ? user?.id ?? null : null, linkId, status, '/', inviter ? inviter.depth + 1 : 0,
      opts.consent ? ts : null, ip, opts.createdAt || ts, opts.createdAt || ts,
    );
    const id = Number(r.lastInsertRowid);
    const path = `${inviter ? inviter.path : '/'}${id}/`;
    q('UPDATE people SET path = ? WHERE id = ?').run(path, id);
    const person = getPerson(id);

    if (isLeader) createLink(person, 'leader', user?.id);
    ensurePersonLink(person, user?.id);

    history(id, 'registered', {
      method, head_id: head.id, head: head.name, inviter_id: inviter?.id ?? null, inviter: inviter?.full_name ?? null,
      leader_id: leaderId, leader_mode: leaderMode, is_leader: !!isLeader, leader_code: leaderCode, status,
      invite_link_id: linkId,
    }, user?.id, opts.reason || null);
    audit(user, method === 'manual' ? 'person.create_manual' : 'person.register_invite', 'person', id,
      { head_id: head.id, inviter_id: inviter?.id ?? null, is_leader: !!isLeader, link_id: linkId }, ip);
    return getPerson(id);
  });
}

/** Registro público mediante enlace. head/inviter se derivan SIEMPRE del token en el servidor. */
export function registerViaInvite(token, body, ip) {
  const { link, owner, head, valid, reason } = resolveInvite(token);
  if (!valid) throw badRequest('LINK_INVALID', reason);
  if (body.website) throw badRequest('SPAM', 'No se pudo procesar el registro.'); // honeypot
  if (!body.consent) throw badRequest('CONSENT_REQUIRED', 'Debe aceptar el tratamiento de datos para registrarse.', { field: 'consent' });
  const person = createPerson({
    data: { full_name: body.full_name, phone: body.phone, email: body.email, document_id: body.document_id, city: body.city },
    headId: head.id,
    inviterId: owner.id,
    isLeader: false,
    method: 'invitation',
    linkId: link.id,
    status: head.requires_approval ? 'pending' : 'active',
    consent: true,
    ip,
  });
  return { person, owner, head };
}

// ---------------------------------------------------------------------------
// Responsabilidad de líderes
// ---------------------------------------------------------------------------

/**
 * Recalcula el líder responsable de una rama: los registros en modo automático
 * toman el líder oficial más cercano en su cadena de invitación.
 * Devuelve el número de personas cuyo líder cambió.
 */
export function recomputeLeaders(rootId, userId = null, reason = null) {
  const root = getPerson(rootId);
  const rows = q(`SELECT id, inviter_id, is_leader, leader_mode, leader_id, head_id, status FROM people
                   WHERE path >= ? AND path < ? ORDER BY depth`).all(root.path, pathUpper(root.path));
  const above = new Map(); // id -> líder más cercano estrictamente por encima
  const byId = new Map(rows.map((r) => [r.id, r]));
  let changed = 0;
  const upd = q('UPDATE people SET leader_id = ?, leader_mode = ?, updated_at = ? WHERE id = ?');
  const ts = now();
  for (const r of rows) {
    let nearest;
    if (r.id === root.id) nearest = nearestLeaderFromPath(root.path, true);
    else {
      const parent = byId.get(r.inviter_id);
      nearest = parent.is_leader ? parent.id : above.get(parent.id);
    }
    above.set(r.id, nearest ?? null);
    let target = r.leader_id;
    let mode = r.leader_mode;
    if (mode === 'manual') {
      const l = r.leader_id ? getPerson(r.leader_id) : null;
      if (!l || !l.is_leader || l.head_id !== r.head_id) { mode = 'auto'; target = nearest ?? null; }
    } else {
      target = nearest ?? null;
    }
    if (target !== r.leader_id || mode !== r.leader_mode) {
      upd.run(target, mode, ts, r.id);
      history(r.id, 'leader_changed', { from: r.leader_id, to: target, mode, automatic: true }, userId, reason);
      changed++;
    }
  }
  return changed;
}

export function promoteToLeader(personId, user, reason, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    if (p.is_leader) throw badRequest('ALREADY_LEADER', 'La persona ya es líder oficial.');
    if (p.status !== 'active') throw badRequest('NOT_ACTIVE', 'Sólo se puede designar como líder a una persona activa.');
    const code = generateLeaderCode(p.full_name);
    q('UPDATE people SET is_leader = 1, leader_code = ?, leader_since = ?, updated_at = ? WHERE id = ?').run(code, now(), now(), p.id);
    const updated = getPerson(p.id);
    createLink(updated, 'leader', user?.id);
    // Su invitación personal deja de ser necesaria: el enlace de líder la sustituye.
    q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:promoted'
        WHERE owner_person_id = ? AND kind = 'person' AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    history(p.id, 'promoted_leader', { leader_code: code }, user?.id, reason);
    // Si tiene cuenta de persona registrada, pasa a cuenta de líder (permiso formal, sólo por designación).
    q(`UPDATE users SET role = 'leader' WHERE person_id = ? AND role = 'member'`).run(p.id);
    const affected = recomputeLeaders(p.id, user?.id, `Designación de ${p.full_name} como líder`);
    audit(user, 'person.promote_leader', 'person', p.id, { leader_code: code, affected }, ip);
    return { person: getPerson(p.id), affected };
  });
}

export function demoteLeader(personId, user, reason, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    if (!p.is_leader) throw badRequest('NOT_LEADER', 'La persona no es líder.');
    if (!p.inviter_id) {
      throw badRequest('ROOT_LEADER', 'Es un líder raíz de la cabeza: antes de retirarle el liderazgo debe moverlo debajo de otra persona.');
    }
    q('UPDATE people SET is_leader = 0, leader_since = NULL, updated_at = ? WHERE id = ?').run(now(), p.id);
    q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:demoted'
        WHERE owner_person_id = ? AND kind = 'leader' AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    history(p.id, 'demoted_leader', { leader_code: p.leader_code }, user?.id, reason);
    q(`UPDATE users SET role = 'member' WHERE person_id = ? AND role = 'leader'`).run(p.id);
    // Personas asignadas manualmente a este líder vuelven a modo automático.
    const manual = q(`SELECT id FROM people WHERE leader_id = ? AND leader_mode = 'manual'`).all(p.id);
    for (const m of manual) {
      q(`UPDATE people SET leader_mode = 'auto' WHERE id = ?`).run(m.id);
    }
    let affected = recomputeLeaders(p.id, user?.id, `Retiro de liderazgo de ${p.full_name}`);
    for (const m of manual) affected += recomputeLeaders(m.id, user?.id, `Retiro de liderazgo de ${p.full_name}`);
    ensurePersonLink(getPerson(p.id), user?.id);
    audit(user, 'person.demote_leader', 'person', p.id, { affected }, ip);
    return { person: getPerson(p.id), affected };
  });
}

/** Asigna manualmente un líder responsable (o vuelve a automático con leaderId = null). */
export function setResponsibleLeader(personId, leaderId, user, reason, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    const before = p.leader_id;
    if (leaderId) {
      const l = getPerson(leaderId);
      if (!l || !l.is_leader || l.head_id !== p.head_id || l.status === 'rejected') {
        throw badRequest('LEADER_INVALID', 'El líder responsable debe ser un líder oficial de la misma cabeza.');
      }
      if (l.id === p.id) throw badRequest('LEADER_INVALID', 'Una persona no puede ser su propio líder responsable.');
      q(`UPDATE people SET leader_id = ?, leader_mode = 'manual', updated_at = ? WHERE id = ?`).run(l.id, now(), p.id);
      history(p.id, 'leader_changed', { from: before, to: l.id, mode: 'manual' }, user?.id, reason);
    } else {
      const nearest = nearestLeaderFromPath(p.path, true);
      q(`UPDATE people SET leader_id = ?, leader_mode = 'auto', updated_at = ? WHERE id = ?`).run(nearest, now(), p.id);
      history(p.id, 'leader_changed', { from: before, to: nearest, mode: 'auto' }, user?.id, reason);
    }
    audit(user, 'person.set_leader', 'person', p.id, { from: before, to: leaderId ?? 'auto' }, ip);
    return getPerson(p.id);
  });
}

// ---------------------------------------------------------------------------
// Movimientos (procedimiento autorizado con historial)
// ---------------------------------------------------------------------------

/**
 * Mueve a una persona (con toda su rama) bajo otro invitador, en la misma u otra cabeza.
 * newInviterId = null => la persona (que debe ser líder) pasa a colgar directamente de la cabeza destino.
 */
export function movePerson(personId, { newInviterId = null, newHeadId = null }, user, reason, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    if (p.status === 'rejected') throw badRequest('INVALID_STATE', 'No se puede mover un registro rechazado.');
    if (!reason || String(reason).trim().length < 5) throw badRequest('REASON_REQUIRED', 'Debe indicar el motivo del movimiento (mín. 5 caracteres).', { field: 'reason' });
    let target = null;
    let headId;
    if (newInviterId) {
      target = getPerson(newInviterId);
      if (!target) throw badRequest('VALIDATION', 'El nuevo invitador no existe.');
      if (target.status !== 'active') throw badRequest('INVITER_INACTIVE', 'El nuevo invitador no está activo.');
      if (target.path.startsWith(p.path)) {
        throw badRequest('CYCLE', 'Movimiento no permitido: el destino está dentro de la propia rama de la persona (relación circular).');
      }
      headId = target.head_id;
      if (newHeadId && Number(newHeadId) !== headId) throw badRequest('INVITER_OTHER_HEAD', 'El nuevo invitador no pertenece a la cabeza indicada.');
    } else {
      if (!p.is_leader) throw badRequest('INVITER_REQUIRED', 'Sólo un líder puede colgar directamente de una cabeza.');
      headId = Number(newHeadId || p.head_id);
    }
    const head = getHead(headId);
    if (!head || head.status !== 'active') throw badRequest('VALIDATION', 'La cabeza destino no es válida.');
    if ((target?.id ?? null) === p.inviter_id && headId === p.head_id) throw badRequest('NO_CHANGE', 'La persona ya está en esa posición.');

    const oldPath = p.path;
    const newPath = `${target ? target.path : '/'}${p.id}/`;
    const deltaDepth = (target ? target.depth + 1 : 0) - p.depth;
    const crossHead = headId !== p.head_id;
    const subtree = q('SELECT id FROM people WHERE path >= ? AND path < ?').all(oldPath, pathUpper(oldPath)).map((r) => r.id);

    q(`UPDATE people SET path = ? || substr(path, ?), depth = depth + ?, head_id = ?, updated_at = ?
        WHERE path >= ? AND path < ?`).run(newPath, oldPath.length + 1, deltaDepth, headId, now(), oldPath, pathUpper(oldPath));
    q('UPDATE people SET inviter_id = ? WHERE id = ?').run(target?.id ?? null, p.id);

    history(p.id, crossHead ? 'moved_head' : 'moved', {
      from_head_id: p.head_id, to_head_id: headId, from_inviter_id: p.inviter_id, to_inviter_id: target?.id ?? null,
      branch_size: subtree.length,
    }, user?.id, reason);
    if (crossHead) {
      for (const id of subtree) {
        if (id !== p.id) history(id, 'moved_head', { from_head_id: p.head_id, to_head_id: headId, via_branch_of: p.id }, user?.id, reason);
      }
    }
    const affected = recomputeLeaders(p.id, user?.id, `Movimiento de rama: ${reason}`);
    audit(user, crossHead ? 'person.move_head' : 'person.move', 'person', p.id, {
      from_head_id: p.head_id, to_head_id: headId, from_inviter_id: p.inviter_id, to_inviter_id: target?.id ?? null,
      branch_size: subtree.length, leaders_recomputed: affected,
    }, ip);
    return { person: getPerson(p.id), branchSize: subtree.length, affected };
  });
}

// ---------------------------------------------------------------------------
// Estado y datos
// ---------------------------------------------------------------------------

export function setStatus(personId, status, user, reason, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    const allowed = {
      pending: ['active', 'rejected'],
      active: ['inactive'],
      inactive: ['active'],
      rejected: [],
    };
    if (!allowed[p.status].includes(status)) {
      throw badRequest('INVALID_TRANSITION', `No se puede pasar de "${p.status}" a "${status}".`);
    }
    if (status === 'rejected') {
      const kids = q(`SELECT COUNT(*) n FROM people WHERE inviter_id = ? AND status <> 'rejected'`).get(p.id).n;
      if (kids) throw badRequest('HAS_CHILDREN', 'No se puede rechazar a una persona que ya tiene invitados.');
      if (p.is_leader) throw badRequest('INVALID_TRANSITION', 'No se puede rechazar a un líder.');
    }
    if (status === 'active') assertNoDuplicate(p, p.id);
    q('UPDATE people SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), p.id);
    if (status === 'inactive') {
      q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:person_inactive'
          WHERE owner_person_id = ? AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    }
    if (status === 'active') {
      if (p.is_leader) {
        const l = q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = 'leader' AND disabled_reason = 'auto:person_inactive' ORDER BY id DESC LIMIT 1`).get(p.id);
        if (l) q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
      }
      ensurePersonLink(getPerson(p.id), user?.id);
    }
    const type = { active: p.status === 'pending' ? 'approved' : 'reactivated', inactive: 'deactivated', rejected: 'rejected' }[status];
    history(p.id, type, { from: p.status, to: status }, user?.id, reason);
    audit(user, `person.${type}`, 'person', p.id, { from: p.status, to: status }, ip);
    return getPerson(p.id);
  });
}

export function updatePersonData(personId, body, user, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    const merged = {
      full_name: body.full_name ?? p.full_name,
      phone: body.phone ?? p.phone,
      email: body.email !== undefined ? body.email : p.email,
      document_id: body.document_id !== undefined ? body.document_id : p.document_id,
      city: body.city ?? p.city,
      notes: body.notes ?? p.notes,
    };
    const data = validatePersonData(merged);
    if (p.status !== 'rejected') assertNoDuplicate(data, p.id);
    const changes = {};
    for (const k of Object.keys(data)) {
      if ((data[k] ?? null) !== (p[k] ?? null)) changes[k] = { from: p[k] ?? null, to: data[k] ?? null };
    }
    if (!Object.keys(changes).length) return p;
    q(`UPDATE people SET full_name = ?, name_key = ?, phone = ?, email = ?, document_id = ?, city = ?, notes = ?, updated_at = ?
        WHERE id = ?`).run(data.full_name, normalizeText(data.full_name), data.phone, data.email, data.document_id, data.city,
      data.notes, now(), p.id);
    history(p.id, 'data_updated', { fields: changes }, user?.id, body.reason || null);
    audit(user, 'person.update', 'person', p.id, { fields: Object.keys(changes) }, ip);
    return getPerson(p.id);
  });
}

/** Genera (o regenera) la invitación personal de una persona. */
export function regeneratePersonLink(personId, user, ip) {
  return tx(() => {
    const p = getPerson(personId);
    if (!p) throw notFound();
    if (p.status !== 'active') throw badRequest('NOT_ACTIVE', 'La persona no está activa.');
    const kind = p.is_leader ? 'leader' : 'person';
    if (kind === 'person' && !getHead(p.head_id).person_invites_enabled) {
      throw forbidden('Las invitaciones personales están deshabilitadas en esta cabeza.');
    }
    q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'Regenerado'
        WHERE owner_person_id = ? AND kind = ? AND status = 'active'`).run(now(), user?.id ?? null, p.id, kind);
    let id;
    if (kind === 'leader') {
      // El código de líder es estable; se reactiva el enlace con ese token si existe.
      const l = q(`SELECT id FROM invite_links WHERE token = ?`).get(p.leader_code);
      if (l) {
        q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
        id = l.id;
      } else id = createLink(p, 'leader', user?.id);
    } else id = createLink(p, 'person', user?.id);
    audit(user, 'link.regenerate', 'invite_link', id, { person_id: p.id, kind }, ip);
    history(p.id, 'link_regenerated', { kind, link_id: id }, user?.id);
    return q('SELECT * FROM invite_links WHERE id = ?').get(id);
  });
}

// ---------------------------------------------------------------------------
// Verificación de integridad
// ---------------------------------------------------------------------------

export function integrityReport() {
  const issues = [];
  const add = (type, rows, msg) => rows.forEach((r) => issues.push({ type, person_id: r.id, message: msg }));
  add('path', q(`SELECT c.id FROM people c LEFT JOIN people i ON i.id = c.inviter_id
                 WHERE c.path <> COALESCE(i.path, '/') || c.id || '/'`).all(), 'Ruta de árbol inconsistente');
  add('depth', q(`SELECT c.id FROM people c LEFT JOIN people i ON i.id = c.inviter_id
                  WHERE c.depth <> COALESCE(i.depth + 1, 0)`).all(), 'Profundidad inconsistente');
  add('head', q(`SELECT c.id FROM people c JOIN people i ON i.id = c.inviter_id WHERE c.head_id <> i.head_id`).all(),
    'Pertenece a una cabeza distinta de la de su invitador');
  add('leader', q(`SELECT c.id FROM people c JOIN people l ON l.id = c.leader_id
                   WHERE l.is_leader = 0 OR l.head_id <> c.head_id`).all(), 'Líder responsable inválido');
  add('root', q(`SELECT id FROM people WHERE inviter_id IS NULL AND is_leader = 0 AND status <> 'rejected'`).all(),
    'Persona sin invitador que no es líder');
  add('dup_phone', q(`SELECT MIN(id) id FROM people WHERE status <> 'rejected' GROUP BY phone HAVING COUNT(*) > 1`).all(), 'Teléfono duplicado');
  // Auto-asignación: el líder debe coincidir con el líder más cercano en la cadena.
  const autos = q(`SELECT id, path, leader_id FROM people WHERE leader_mode = 'auto'`).all();
  if (autos.length <= 50000) {
    const leaders = new Set(q('SELECT id FROM people WHERE is_leader = 1').all().map((r) => r.id));
    for (const a of autos) {
      const ids = ancestorIds(a.path); ids.pop();
      let nearest = null;
      for (let i = ids.length - 1; i >= 0; i--) if (leaders.has(ids[i])) { nearest = ids[i]; break; }
      if (nearest !== a.leader_id) issues.push({ type: 'leader_auto', person_id: a.id, message: 'Líder automático desactualizado' });
    }
  }
  return { ok: issues.length === 0, checked_at: now(), issues: issues.slice(0, 500), total_issues: issues.length };
}
