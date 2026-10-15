// Reglas de negocio de personas, líderes, árbol de invitación y enlaces.
import { q, tx, now, pathUpper, MAX_PATH, sqlExec, adoptRootLeaders } from '../db.js';
import {
  AppError, badRequest, conflict, notFound, forbidden, normalizeText, slugUpper, randomCode,
  validatePhone, validateMobile, validateCedula, validateEmail, assertEmailDomain, normalizePhone, str, sha256, slugLower,
} from '../util.js';
import crypto from 'node:crypto';
import { audit, history } from './audit.js';
import { resolveLocation, geoIntegrity } from './geo.js';
import { IS_PRODUCTION } from '../env.js';

const ONE_TIME_DAYS = Number(process.env.ONE_TIME_LINK_DAYS) || 7;
const EMAIL_DNS = process.env.EMAIL_DNS_CHECK ? process.env.EMAIL_DNS_CHECK === '1' : IS_PRODUCTION;

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

async function tokenTaken(token) {
  return !!(await q('SELECT 1 FROM invite_links WHERE token = ?').get(token)
    || await q('SELECT 1 FROM people WHERE leader_code = ?').get(token));
}

/** LID-JUAN-PEREZ, LID-JUAN-PEREZ-2, ... (único aunque haya homónimos). */
export async function generateLeaderCode(fullName) {
  const base = `LID-${slugUpper(fullName)}`;
  if (!await tokenTaken(base)) return base;
  for (let i = 2; ; i++) {
    const c = `${base}-${i}`;
    if (!await tokenTaken(c)) return c;
  }
}

async function generatePersonCode() {
  for (;;) {
    const c = `PER-${randomCode(6)}`;
    if (!await q('SELECT 1 FROM people WHERE code = ?').get(c)) return c;
  }
}

/** Invitación personal: INV-MARIA-GOMEZ-7KQ3 (sufijo aleatorio: no adivinable). */
async function generatePersonInviteToken(fullName) {
  const base = `INV-${slugUpper(fullName, 2)}`;
  for (;;) {
    const c = `${base}-${randomCode(4)}`;
    if (!await tokenTaken(c)) return c;
  }
}

// ---------------------------------------------------------------------------
// Consultas auxiliares
// ---------------------------------------------------------------------------

export async function getPerson(id) {
  const p = await q('SELECT * FROM people WHERE id = ?').get(id);
  if (p) { p.panel_active = !!p.panel_token_hash; delete p.panel_token_hash; } // la huella del panel nunca sale del servidor
  return p;
}

export async function getHead(id) {
  return await q('SELECT * FROM heads WHERE id = ?').get(id);
}

/** La cabeza (persona) de una estructura: su líder raíz, de quien cuelgan sus líderes y personas. */
export async function headPerson(headId) {
  return await q(`SELECT id, code, full_name, first_names, status, path, leader_code FROM people
                   WHERE head_id = ? AND is_head = 1 AND status <> 'rejected'`).get(headId);
}

/** Papel organizativo de una persona: 'head' (cabeza), 'leader' o 'person'. */
export const roleOf = (p) => (p.is_head ? 'head' : p.is_leader ? 'leader' : 'person');

export const ancestorIds = (path) => path.split('/').filter(Boolean).map(Number);

/**
 * Contadores mantenidos: suma `delta` a descendant_count de todos los nodos de `path`
 * (inclusive) y opcionalmente a child_count del invitador directo.
 */
async function bumpCounts(path, delta, inviterId = null) {
  const ids = ancestorIds(path);
  if (ids.length) {
    await q(`UPDATE people SET descendant_count = descendant_count + ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(delta, ...ids);
  }
  if (inviterId) await q('UPDATE people SET child_count = child_count + ? WHERE id = ?').run(delta > 0 ? 1 : -1, inviterId);
}

/** Líder más cercano por encima de una ruta (excluyendo al propio nodo final si excludeSelf). */
export async function nearestLeaderFromPath(path, excludeSelf = true) {
  const ids = ancestorIds(path);
  if (excludeSelf) ids.pop();
  if (!ids.length) return null;
  const row = await q(`SELECT id FROM people WHERE id IN (${ids.map(() => '?').join(',')}) AND is_leader = 1
                  ORDER BY depth DESC LIMIT 1`).get(...ids);
  return row ? row.id : null;
}

/**
 * Campos de persona (iguales en registro manual y por enlace).
 * legacy: registros anteriores a estos campos pueden editarse sin completar los nuevos obligatorios.
 */
const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Nombres y apellidos por separado (formulario actual) o nombre completo (API y registros anteriores). */
function validateNames(data) {
  if (data.first_names === undefined && data.last_names === undefined) {
    const full_name = str(data.full_name, { field: 'nombre completo', key: 'full_name', required: true, min: 3, max: 120 });
    if (!/\p{L}/u.test(full_name)) throw badRequest('VALIDATION', 'El nombre no es válido.', { field: 'full_name' });
    return { full_name: cleanName(full_name), first_names: data.keepNames?.first_names ?? null, last_names: data.keepNames?.last_names ?? null };
  }
  const part = (v, key, label) => {
    const x = cleanName(str(v, { field: label, key, required: true, max: 60 }));
    if (!/^[\p{L}' .-]+$/u.test(x) || (x.match(/\p{L}/gu) || []).length < 2) {
      throw badRequest('VALIDATION', `Escriba ${label === 'nombres' ? 'los nombres' : 'los apellidos'} sólo con letras.`, { field: key });
    }
    return x;
  };
  const first_names = part(data.first_names, 'first_names', 'nombres');
  const last_names = part(data.last_names, 'last_names', 'apellidos');
  return { full_name: `${first_names} ${last_names}`, first_names, last_names };
}

/** Respuesta Sí/No: 'yes' | 'no' | null. */
function validateYesNo(v, field, { required = false, message } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest('VALIDATION', message, { field });
    return null;
  }
  const x = v === true || v === 'yes' || v === 'si' || v === 'sí' ? 'yes' : v === false || v === 'no' ? 'no' : null;
  if (!x) throw badRequest('VALIDATION', 'Respuesta no válida.', { field });
  return x;
}

function validatePersonData(data, { legacy = null } = {}) {
  const names = validateNames(data);
  const address = str(data.address, { field: 'dirección', key: 'address', max: 200, required: !legacy || !!legacy.address });
  if (address && address.length < 5) throw badRequest('VALIDATION', 'La dirección es demasiado corta.', { field: 'address' });
  return {
    ...names,
    document_id: validateCedula(data.document_id, { required: !legacy || !!legacy.document_id }),
    address: address || null,
    phone: legacy && !legacy.phone_changed ? validatePhone(data.phone) : validateMobile(data.phone),
    email: validateEmail(data.email),
    city: str(data.city, { field: 'ciudad / municipio', max: 80 }),
    notes: str(data.notes, { field: 'observaciones', max: 500 }),
    // «¿Contamos contigo?» la responde la propia persona (registro por enlace).
    supports: validateYesNo(data.supports, 'supports', { required: !!data.requireSupports, message: 'Responda si contamos contigo en este camino.' }),
    // «¿Es voto seguro?» la valora quien registra (registro manual o edición en la ficha).
    secure_vote: validateYesNo(data.secure_vote, 'secure_vote', { required: !!data.requireSecureVote, message: 'Indique si es voto seguro.' }),
  };
}

/** Detecta duplicados por teléfono o documento (en todas las cabezas). */
export async function findDuplicate({ phone, document_id }, excludeId = null) {
  const byPhone = await q(`SELECT id, code, full_name, head_id FROM people WHERE phone = ? AND status <> 'rejected' AND id IS DISTINCT FROM ?::int`)
    .get(phone, excludeId);
  if (byPhone) return { field: 'phone', person: byPhone };
  if (document_id) {
    const byDoc = await q(`SELECT id, code, full_name, head_id FROM people WHERE document_id = ? AND status <> 'rejected' AND id IS DISTINCT FROM ?::int`)
      .get(document_id, excludeId);
    if (byDoc) return { field: 'document_id', person: byDoc };
  }
  return null;
}

async function assertNoDuplicate(data, excludeId = null) {
  const dup = await findDuplicate(data, excludeId);
  if (dup) {
    const what = dup.field === 'phone' ? 'ese celular' : 'esa cédula';
    throw conflict('DUPLICATE', `Ya existe una persona registrada con ${what}.`, {
      field: dup.field, existing: { id: dup.person.id, code: dup.person.code, head_id: dup.person.head_id },
    });
  }
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

async function createLink(person, kind, userId) {
  const token = kind === 'leader' ? person.leader_code : await generatePersonInviteToken(person.full_name);
  const r = await q('INSERT INTO invite_links (token, kind, owner_person_id, created_by) VALUES (?, ?, ?, ?)')
    .run(token, kind, person.id, userId ?? null);
  return Number(r.lastInsertRowid);
}

async function activeLink(personId, kind) {
  return await q(`SELECT * FROM invite_links WHERE owner_person_id = ? AND kind = ? AND status = 'active' ORDER BY id DESC LIMIT 1`)
    .get(personId, kind);
}

/** Garantiza que una persona activa tenga su invitación personal (si la cabeza lo permite). */
async function ensurePersonLink(person, userId) {
  const head = await getHead(person.head_id);
  if (!head.person_invites_enabled || person.is_leader || person.status !== 'active') return null;
  // Se reactiva el último enlace suspendido automáticamente antes de crear uno nuevo.
  if (await activeLink(person.id, 'person')) return null;
  const auto = await q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = 'person' AND status = 'disabled'
                   AND disabled_reason = 'auto:person_inactive' ORDER BY id DESC LIMIT 1`).get(person.id);
  if (auto) {
    await q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(auto.id);
    return auto.id;
  }
  return await createLink(person, 'person', userId);
}

// ---------------------------------------------------------------------------
// Tipos de registro (cabeza / líder / persona, con color)
// ---------------------------------------------------------------------------

export const regTypeById = (id) => q('SELECT * FROM reg_types WHERE id = ?').get(id);
export const builtinType = (role) => q('SELECT * FROM reg_types WHERE builtin = 1 AND role = ?').get(role);

const ROLE_PLURAL = { head: 'cabezas', leader: 'líderes', person: 'personas' };

/** Tipo de registro compatible con el papel (cabeza, líder o persona). */
async function typeFor(regTypeId, role) {
  const t = regTypeId ? await regTypeById(regTypeId) : await builtinType(role);
  if (!t) throw badRequest('VALIDATION', 'El tipo de registro no existe.', { field: 'reg_type_id' });
  if (t.role !== role) {
    throw badRequest('VALIDATION', `El tipo «${t.name}» es para ${ROLE_PLURAL[t.role]}.`, { field: 'reg_type_id' });
  }
  return t;
}

/** Crea una cabeza (nombre único). La usan el administrador y los enlaces de registro de tipo «cabeza». */
export async function createHeadRecord(d, userId = null) {
  let name = d.name;
  for (let i = 2; await q('SELECT 1 FROM heads WHERE lower(name) = lower(?)').get(name); i++) name = `${d.name} (${i})`;
  let slug = slugLower(name);
  for (let i = 2; await q('SELECT 1 FROM heads WHERE slug = ?').get(slug); i++) slug = `${slugLower(name)}-${i}`;
  const r = await q(`INSERT INTO heads (name, slug, description, region, color, requires_approval, person_invites_enabled, created_by)
               VALUES (?,?,?,?,?,?,?,?)`).run(name, slug, d.description || '', d.region || '', d.color || '#2a78d6',
    d.requires_approval ?? 0, d.person_invites_enabled ?? 1, userId);
  return await getHead(Number(r.lastInsertRowid));
}

/** Resuelve un token público. Toda la información estructural sale de la BD, nunca de la URL. */
export async function resolveInvite(rawToken) {
  const token = String(rawToken ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,80}$/.test(token)) throw notFound('El enlace de invitación no es válido.');
  const link = await q('SELECT * FROM invite_links WHERE token = ?').get(token);
  if (!link) throw notFound('El enlace de invitación no es válido.');
  // Enlaces de líder/persona: quien se registra es una persona invitada por el dueño del enlace.
  // Enlaces de registro: el tipo decide si se registra una persona, un líder o una nueva cabeza.
  const type = link.reg_type_id ? await regTypeById(link.reg_type_id) : await builtinType('person');
  const role = link.kind === 'register' ? type.role : 'person';
  const owner = link.owner_person_id ? await getPerson(link.owner_person_id) : null;
  const head = role === 'head' ? null : await getHead(link.head_id ?? owner.head_id);
  let reason = null;
  if (link.status !== 'active') {
    reason = link.disabled_reason === 'auto:usado' ? 'Este enlace ya fue usado: es personal y sirve para un solo registro.' : 'Este enlace fue desactivado.';
  } else if (link.expires_at && link.expires_at < now()) reason = 'Este enlace ha caducado.';
  else if (owner && owner.status !== 'active') reason = 'Este enlace ya no está disponible.';
  else if (head && head.status !== 'active') reason = 'Este enlace ya no está disponible.';
  else if (owner && head && owner.head_id !== head.id) reason = 'Este enlace ya no está disponible.';
  else if (link.kind === 'leader' && !owner.is_leader) reason = 'Este enlace ya no está disponible.';
  else if (link.kind === 'register' && !type.active) reason = 'Este enlace ya no está disponible.';
  else if (link.max_uses != null) {
    const used = (await q(`SELECT COUNT(*) n FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(link.id)).n;
    if (used >= link.max_uses) reason = 'Este enlace alcanzó su límite de registros.';
  }
  return { link, owner, head, type, role, valid: !reason, reason };
}

/** Enlace de registro tipado creado por un administrador. */
export async function createRegisterLink(body, user, ip) {
  return await tx(async () => {
    const type = await regTypeById(Number(body.reg_type_id));
    if (!type || !type.active) throw badRequest('VALIDATION', 'Elija un tipo de registro activo.', { field: 'reg_type_id' });
    const label = str(body.label, { field: 'nombre del enlace', key: 'label', max: 120 }) || null;
    let headId = null;
    let owner = null;
    if (type.role === 'head') {
      if (user.role !== 'super_admin') throw forbidden('Sólo el administrador general crea enlaces para registrar cabezas.');
    } else {
      headId = Number(body.head_id) || null;
      const head = headId ? await getHead(headId) : null;
      if (!head || head.status !== 'active') throw badRequest('VALIDATION', 'Elija una cabeza activa.', { field: 'head_id' });
      if (body.owner_person_id) {
        owner = await getPerson(Number(body.owner_person_id));
        if (!owner || owner.head_id !== head.id || owner.status !== 'active') {
          throw badRequest('VALIDATION', 'Quien invita debe ser una persona activa de la misma cabeza.', { field: 'owner_person_id' });
        }
      } else if (type.role === 'person') {
        throw badRequest('VALIDATION', 'Indique de quién cuelgan las personas que se registren con este enlace.', { field: 'owner_person_id' });
      }
    }
    let maxUses = body.max_uses === undefined || body.max_uses === '' || body.max_uses === null ? null : Number(body.max_uses);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw badRequest('VALIDATION', 'Máximo de registros no válido.', { field: 'max_uses' });
    if (type.role === 'head' && maxUses === null && !body.general) maxUses = 1; // por defecto, un enlace por cabeza
    let expires = body.expires_at || null;
    if (expires && Number.isNaN(Date.parse(expires))) throw badRequest('VALIDATION', 'Fecha de caducidad no válida.', { field: 'expires_at' });
    if (expires) expires = new Date(expires).toISOString();
    if (body.oneTime) {
      // Enlace personal: un solo registro, caduca a los 7 días si no se usa y su código es largo (no adivinable).
      maxUses = 1;
      expires = new Date(Date.now() + ONE_TIME_DAYS * 864e5).toISOString();
    }
    const base = `REG-${slugUpper(type.name, 2)}`;
    let token;
    do token = `${base}-${randomCode(body.oneTime ? 12 : 6)}`; while (await tokenTaken(token));
    const r = await q(`INSERT INTO invite_links (token, kind, owner_person_id, reg_type_id, head_id, label, max_uses, expires_at, created_by, is_general, one_time)
                 VALUES (?, 'register', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(token, owner?.id ?? null, type.id, headId, label, maxUses, expires, user.id,
      body.general ? 1 : 0, body.oneTime ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    await audit(user, 'link.create_register', 'invite_link', id, { token, reg_type: type.name, role: type.role, head_id: headId, owner_person_id: owner?.id ?? null }, ip);
    return await q('SELECT * FROM invite_links WHERE id = ?').get(id);
  });
}

/**
 * Enlace general de un tipo, listo para compartir: uno solo por tipo (+ cabeza para líderes y personas,
 * + dueño para personas), sin nombre, límite ni caducidad. Si ya existe uno activo se reutiliza.
 */
export async function ensureGeneralLink(body, user, ip) {
  return await tx(async () => {
    const type = await regTypeById(Number(body.reg_type_id));
    if (!type || !type.active) throw badRequest('VALIDATION', 'Elija un tipo de registro activo.', { field: 'reg_type_id' });
    if (type.role !== 'person') {
      throw badRequest('ONE_TIME_ONLY', 'Las cabezas y los líderes se registran con enlaces de un solo uso.', { field: 'reg_type_id' });
    }
    const headId = Number(body.head_id) || null;
    const ownerId = Number(body.owner_person_id) || null;
    await q('SELECT pg_advisory_xact_lock(724100, ?::int)').get(type.id); // evita duplicados si dos administradores lo piden a la vez
    const found = await q(`SELECT * FROM invite_links WHERE kind = 'register' AND is_general = 1 AND status = 'active' AND reg_type_id = ?
        AND head_id IS NOT DISTINCT FROM ?::int AND owner_person_id IS NOT DISTINCT FROM ?::int ORDER BY id DESC LIMIT 1`).get(type.id, headId, ownerId);
    if (found) return found;
    return await createRegisterLink({ reg_type_id: type.id, head_id: headId, owner_person_id: ownerId, general: true }, user, ip);
  });
}

/** Nuevo enlace personal de un solo uso para registrar una cabeza o un líder. */
export async function createOneTimeLink(body, user, ip) {
  const type = await regTypeById(Number(body.reg_type_id));
  if (!type || !type.active) throw badRequest('VALIDATION', 'Elija un tipo de registro activo.', { field: 'reg_type_id' });
  if (type.role === 'person') throw badRequest('VALIDATION', 'Los tipos de persona usan el enlace general.', { field: 'reg_type_id' });
  return await createRegisterLink({ reg_type_id: type.id, head_id: type.role === 'head' ? null : body.head_id, oneTime: true }, user, ip);
}

// Preparar y marcar enviada se hacen de a una por persona (mismo candado): una invitación recién entregada nunca vuelve
// a salir como la siguiente.
const inviterLock = (userId) => q('SELECT pg_advisory_xact_lock(724102, ?::int)').get(userId);

/** Marca entregada una invitación preparada (dentro de la transacción y con el candado). Devuelve si ya lo estaba. */
async function markSentLocked(l, label, user, ip) {
  if (!l.prepared) {
    if (label && !l.label) await q('UPDATE invite_links SET label = ? WHERE id = ?').run(label, l.id);
    return true;
  }
  await q('UPDATE invite_links SET prepared = 0, prepared_key = NULL, expires_at = ?, label = COALESCE(?, label) WHERE id = ?')
    .run(new Date(Date.now() + ONE_TIME_DAYS * 864e5).toISOString(), label, l.id);
  await audit(user, 'link.sent', 'invite_link', l.id, { token: l.token, ...(label ? { label } : {}) }, ip);
  return false;
}

/**
 * Invitación de un solo uso preparada en un dispositivo: existe antes del toque, así el botón de WhatsApp es un enlace
 * real (un toque, sin ventanas en blanco). No cuenta como enviada hasta que se entrega (markOneTimeSent) o alguien se
 * registra con ella. Se reutiliza mientras siga sin entregar, activa y con más de un día de vigencia.
 * `delivered`: las que el dispositivo ya entregó sin que su aviso llegara (sin conexión, por ejemplo); se marcan
 * enviadas aquí mismo, así nunca vuelven como la siguiente. `exclude`: las que otra pestaña del mismo dispositivo
 * acaba de entregar (su propio aviso las marcará); tampoco se ofrecen.
 */
export async function prepareOneTimeLink({ regTypeId, headId, device, delivered = [], exclude = [] }, user, ip) {
  return await tx(async () => {
    await inviterLock(user.id);
    for (const id of delivered) {
      const l = await q('SELECT * FROM invite_links WHERE id = ? AND one_time = 1 AND created_by = ? FOR UPDATE').get(id, user.id);
      if (l && l.status === 'active' && !l.used_at) await markSentLocked(l, null, user, ip);
    }
    const found = await q(`SELECT * FROM invite_links WHERE one_time = 1 AND prepared = 1 AND status = 'active' AND used_at IS NULL
        AND created_by = ? AND prepared_key = ? AND reg_type_id = ? AND head_id IS NOT DISTINCT FROM ?::int AND expires_at > ?
        AND NOT (id = ANY(?::int[])) ORDER BY id DESC LIMIT 1`)
      .get(user.id, device, regTypeId, headId, new Date(Date.now() + 864e5).toISOString(), exclude);
    if (found) return found;
    const l = await createOneTimeLink({ reg_type_id: regTypeId, head_id: headId }, user, ip);
    await q('UPDATE invite_links SET prepared = 1, prepared_key = ? WHERE id = ?').run(device, l.id);
    return { ...l, prepared: 1, prepared_key: device };
  });
}

/**
 * La invitación preparada se entregó (WhatsApp, compartir o copiar): desde ahora cuenta como enviada y vence en 7 días.
 * `already_sent`: ya se había entregado antes (desde otra pestaña, por ejemplo). Una invitación anulada o ya usada
 * responde LINK_CLOSED: quien la reciba no podrá usarla.
 */
export async function markOneTimeSent(id, { label } = {}, user, ip) {
  return await tx(async () => {
    await inviterLock(user.id);
    const l = await q('SELECT * FROM invite_links WHERE id = ? FOR UPDATE').get(id);
    if (!l || !l.one_time) throw notFound('Invitación no encontrada.');
    if (l.created_by !== user.id) throw forbidden('Esta invitación la preparó otra persona.');
    if (l.status !== 'active' || l.used_at) throw conflict('LINK_CLOSED', 'Esa invitación ya no sirve: se anuló o ya se usó.');
    const text = str(label, { field: 'nombre', key: 'label', max: 60 }) || null;
    const already = await markSentLocked(l, text, user, ip);
    const after = await q('SELECT id, token, label, expires_at FROM invite_links WHERE id = ?').get(l.id);
    return { ok: true, already_sent: already, ...after, stats: await oneTimeStats(l.reg_type_id, l.head_id) };
  });
}

/**
 * Enlace de un solo uso con el que la cabeza de una estructura invita a un líder (desde su panel, sin cuenta).
 * El líder que se registre colgará de ella. Caduca a los 7 días si no se usa.
 */
export async function createHeadLeaderInvite(cabeza, ip) {
  return await tx(async () => {
    if (!cabeza.is_head) throw forbidden('Sólo la cabeza de una estructura invita líderes.');
    if (cabeza.status !== 'active') throw badRequest('NOT_ACTIVE', 'Tu registro aún no está activo.');
    const head = await getHead(cabeza.head_id);
    if (head.status !== 'active') throw badRequest('HEAD_ARCHIVED', 'La estructura está archivada.');
    const type = await builtinType('leader');
    let token;
    do token = `REG-${slugUpper(type.name, 2)}-${randomCode(12)}`; while (await tokenTaken(token));
    const expires = new Date(Date.now() + ONE_TIME_DAYS * 864e5).toISOString();
    const r = await q(`INSERT INTO invite_links (token, kind, owner_person_id, reg_type_id, head_id, label, max_uses, expires_at, created_by, is_general, one_time)
                 VALUES (?, 'register', ?, ?, ?, ?, 1, ?, NULL, 0, 1)`).run(token, cabeza.id, type.id, head.id, `Invitación de ${cabeza.full_name}`, expires);
    const id = Number(r.lastInsertRowid);
    await audit(null, 'link.create_by_head', 'invite_link', id, { token, person_id: cabeza.id, head_id: head.id }, ip);
    return { ...(await q('SELECT token, expires_at FROM invite_links WHERE id = ?').get(id)), stats: await headInviteStats(cabeza.id) };
  });
}

/** Invitaciones de líder enviadas por una cabeza desde su panel: enviadas, usadas y abiertas. */
export async function headInviteStats(personId) {
  const s = await q(`SELECT COUNT(*) AS sent,
      SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used,
      SUM(CASE WHEN used_at IS NULL AND status = 'active' AND (expires_at IS NULL OR expires_at >= ?) THEN 1 ELSE 0 END) AS open
    FROM invite_links WHERE one_time = 1 AND owner_person_id = ?`).get(now(), personId);
  return { sent: s.sent || 0, used: s.used || 0, open: s.open || 0 };
}

/** Resumen de los enlaces de un solo uso de un tipo (y cabeza): enviados, usados, sin usar y caducados. */
export async function oneTimeStats(regTypeId, headId) {
  return await q(`SELECT COUNT(*) AS sent,
      SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used,
      SUM(CASE WHEN used_at IS NULL AND status = 'active' AND (expires_at IS NULL OR expires_at >= ?) THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN used_at IS NULL AND status = 'active' AND expires_at < ? THEN 1 ELSE 0 END) AS expired
    FROM invite_links WHERE one_time = 1 AND prepared = 0 AND reg_type_id = ? AND head_id IS NOT DISTINCT FROM ?::int`).get(now(), now(), regTypeId, headId);
}

/**
 * Desactiva los enlaces de un solo uso que siguen sin usar (por ejemplo, si se enviaron a quien no debía). También
 * apaga las invitaciones preparadas en los dispositivos (por si alguna se entregó sin quedar marcada): cada dispositivo
 * prepara una nueva. La cifra devuelta cuenta sólo las enviadas.
 */
export async function revokeOpenOneTime(regTypeId, headId, user, ip) {
  const rows = await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'Anulado: enlaces sin usar'
      WHERE one_time = 1 AND used_at IS NULL AND status = 'active' AND reg_type_id = ? AND head_id IS NOT DISTINCT FROM ?::int
      RETURNING prepared`).all(now(), user.id, regTypeId, headId);
  const revoked = rows.filter((r) => !r.prepared).length;
  await audit(user, 'link.revoke_one_time', 'reg_type', regTypeId, { head_id: headId, count: revoked, prepared: rows.length - revoked }, ip);
  return { revoked };
}

// ---------------------------------------------------------------------------
// Panel privado del líder (sólo lectura, enlace secreto + PIN)
// ---------------------------------------------------------------------------

/** Emite (o reemplaza) el enlace secreto del panel. Sólo se guarda su huella: el enlace anterior deja de funcionar. */
export async function issuePanelToken(personId) {
  const token = crypto.randomBytes(24).toString('base64url');
  // Un enlace nuevo empieza sin intentos fallidos ni bloqueo.
  await q(`UPDATE people SET panel_token_hash = ?, panel_created_at = ?, panel_viewed_at = NULL, panel_fails = 0, panel_locked_until = NULL
           WHERE id = ?`).run(sha256(token), now(), personId);
  return token;
}

const RECOVER_MAX = 5;
const RECOVER_LOCK_MS = 30 * 60e3;

/** Líder o cabeza que se registró con este enlace de un solo uso (ya usado) y puede volver a su panel. */
export async function recoverableLeader(link) {
  if (!link?.one_time || !link.used_at) return null;
  return await q(`SELECT * FROM people WHERE invite_link_id = ? AND is_leader = 1 AND status IN ('active','pending')
                  ORDER BY id LIMIT 1`).get(link.id);
}

/**
 * Volver al panel con el enlace de registro ya usado: quien se registró escribe su cédula y su celular completos.
 * Hace falta tener el enlace privado (código aleatorio de 12 caracteres) y los dos datos. Emite un enlace nuevo del
 * panel (el anterior deja de funcionar). Tras 5 intentos fallidos el enlace se bloquea 30 minutos; el contador vive en
 * la base de datos, así que vale aunque haya varias instancias del servidor.
 */
export async function recoverPanel(rawToken, body, ip) {
  const token = String(rawToken ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,80}$/.test(token)) throw notFound('Este enlace no es válido.');
  const link = await q('SELECT * FROM invite_links WHERE token = ?').get(token);
  const person = await recoverableLeader(link);
  if (!person) throw notFound('Este enlace no sirve para volver a un panel. Pide uno nuevo a tu coordinador.');
  if (link.recover_locked_until && link.recover_locked_until > now()) {
    throw new AppError(429, 'RECOVER_LOCKED', 'Demasiados intentos. Espera 30 minutos e inténtalo de nuevo.');
  }
  const doc = String(body?.document_id ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const phone = normalizePhone(body?.phone);
  if (!doc || !phone || doc !== person.document_id || phone !== person.phone) {
    const { recover_fails: fails } = await q('UPDATE invite_links SET recover_fails = recover_fails + 1 WHERE id = ? RETURNING recover_fails').get(link.id);
    await audit(null, 'panel.recover_failed', 'person', person.id, { link_id: link.id, fails }, ip);
    if (fails >= RECOVER_MAX) {
      await q('UPDATE invite_links SET recover_fails = 0, recover_locked_until = ? WHERE id = ?')
        .run(new Date(Date.now() + RECOVER_LOCK_MS).toISOString(), link.id);
      throw new AppError(429, 'RECOVER_LOCKED', 'Demasiados intentos. Espera 30 minutos e inténtalo de nuevo.');
    }
    throw new AppError(401, 'RECOVER_MISMATCH', `La cédula o el celular no coinciden con este registro. Te quedan ${RECOVER_MAX - fails} intentos.`);
  }
  await q('UPDATE invite_links SET recover_fails = 0, recover_locked_until = NULL WHERE id = ?').run(link.id);
  const panelToken = await issuePanelToken(person.id);
  await history(person.id, 'panel_recovered', { link_id: link.id });
  await audit(null, 'panel.recover', 'person', person.id, { link_id: link.id }, ip);
  return { panel_token: panelToken, is_head: !!person.is_head };
}

export async function revokePanelToken(personId) {
  await q('UPDATE people SET panel_token_hash = NULL, panel_created_at = NULL, panel_viewed_at = NULL WHERE id = ?').run(personId);
}

// ---------------------------------------------------------------------------
// Alta de personas
// ---------------------------------------------------------------------------

/**
 * Crea una persona respetando todas las reglas de pertenencia, responsabilidad e invitación.
 * opts: { data, headId, inviterId, isLeader, isHead, leaderOverrideId, method, user, linkId, status, ip, reason }
 * isHead: la persona es la cabeza de la estructura (líder raíz, una por estructura).
 * Un líder sin padrino cuelga de la cabeza de la estructura, si la tiene.
 */
export async function createPerson(opts) {
  return await tx(async () => {
    const { headId, isHead = false, leaderOverrideId = null, method, user = null, linkId = null, ip = null } = opts;
    let { inviterId = null } = opts;
    const isLeader = isHead || !!opts.isLeader;
    const data = validatePersonData(opts.data || {});
    const regType = await typeFor(opts.regTypeId, isHead ? 'head' : isLeader ? 'leader' : 'person');
    await assertEmailDomain(data.email, { enabled: EMAIL_DNS });
    const geo = await resolveLocation(opts.data?.location, { required: true });
    const head = await getHead(headId);
    if (!head) throw badRequest('VALIDATION', 'Debe seleccionar una cabeza válida.', { field: 'head_id' });
    if (head.status !== 'active') throw badRequest('HEAD_ARCHIVED', 'La cabeza está archivada y no admite registros.');

    if (isHead) {
      if (inviterId) throw badRequest('HEAD_ROOT', 'La cabeza es la raíz de su estructura: no la invita nadie.', { field: 'inviter_id' });
      const current = await headPerson(head.id);
      if (current) throw badRequest('HEAD_TAKEN', `Esta estructura ya tiene cabeza: ${current.full_name}.`, { field: 'head_id' });
    } else if (!inviterId && isLeader) {
      const cabeza = await headPerson(head.id);
      if (cabeza?.status === 'active') inviterId = cabeza.id;
    }

    let inviter = null;
    if (inviterId) {
      inviter = await getPerson(inviterId);
      if (!inviter) throw badRequest('VALIDATION', 'La persona que invita no existe.', { field: 'inviter_id' });
      if (inviter.head_id !== head.id) {
        throw badRequest('INVITER_OTHER_HEAD', 'La persona que invita pertenece a otra cabeza. Una persona no puede pertenecer a dos cabezas.', { field: 'inviter_id' });
      }
      if (inviter.status !== 'active') throw badRequest('INVITER_INACTIVE', 'La persona que invita no está activa.', { field: 'inviter_id' });
    } else if (!isLeader) {
      throw badRequest('INVITER_REQUIRED', 'Debe indicar quién invitó a la persona. Sólo un líder puede colgar directamente de la cabeza.', { field: 'inviter_id' });
    }

    await assertNoDuplicate(data);

    // Responsabilidad organizativa.
    let leaderId = null;
    let leaderMode = 'auto';
    if (leaderOverrideId && !isHead) {
      const l = await getPerson(leaderOverrideId);
      if (!l || !l.is_leader || l.head_id !== head.id || l.status === 'rejected') {
        throw badRequest('LEADER_INVALID', 'El líder responsable debe ser un líder oficial de la misma cabeza.', { field: 'leader_id' });
      }
      leaderId = l.id;
      leaderMode = 'manual';
    } else if (inviter) {
      leaderId = inviter.is_leader ? inviter.id : await nearestLeaderFromPath(inviter.path, false);
    }

    const status = opts.status || 'active';
    const code = await generatePersonCode();
    const leaderCode = isLeader ? await generateLeaderCode(data.full_name) : null;
    const ts = now();
    const r = await q(`INSERT INTO people (code, full_name, name_key, phone, email, document_id, city, notes, head_id, inviter_id,
                   leader_id, leader_mode, is_leader, leader_code, leader_since, registration_method, registered_by_user_id,
                   invite_link_id, status, path, depth, consent_at, registration_ip, created_at, updated_at,
                   address, geo_localidad_id, geo_comuna_id, geo_barrio_id, geo_localidad_text, geo_comuna_text, geo_barrio_text, geo_status,
                   first_names, last_names, supports, reg_type_id, secure_vote, is_head)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      code, data.full_name, normalizeText(data.full_name), data.phone, data.email, data.document_id, data.city, data.notes,
      head.id, inviter?.id ?? null, leaderId, leaderMode, isLeader ? 1 : 0, leaderCode, isLeader ? ts : null,
      method, method === 'manual' ? user?.id ?? null : null, linkId, status, '/', inviter ? inviter.depth + 1 : 0,
      opts.consent ? ts : null, ip, opts.createdAt || ts, opts.createdAt || ts,
      data.address, geo.geo_localidad_id, geo.geo_comuna_id, geo.geo_barrio_id, geo.geo_localidad_text, geo.geo_comuna_text,
      geo.geo_barrio_text, geo.geo_status, data.first_names, data.last_names, data.supports, regType.id, data.secure_vote, isHead ? 1 : 0,
    );
    const id = Number(r.lastInsertRowid);
    const path = `${inviter ? inviter.path : '/'}${id}/`;
    if (path.length > MAX_PATH) throw badRequest('TOO_DEEP', 'La rama alcanzó la profundidad máxima permitida.');
    await q('UPDATE people SET path = ? WHERE id = ?').run(path, id);
    if (inviter) await bumpCounts(inviter.path, 1, inviter.id);
    // La cabeza es la raíz de su estructura: los líderes que colgaban sueltos de ella pasan a colgar de la cabeza.
    if (isHead) {
      await adoptRootLeaders(sqlExec, { id, head_id: head.id, path },
        { userId: user?.id ?? null, reason: `${data.full_name} es la cabeza de la estructura` });
    }
    const person = await getPerson(id);

    if (isLeader) await createLink(person, 'leader', user?.id);
    await ensurePersonLink(person, user?.id);

    await history(id, 'registered', {
      method, head_id: head.id, head: head.name, inviter_id: inviter?.id ?? null, inviter: inviter?.full_name ?? null,
      leader_id: leaderId, leader_mode: leaderMode, is_leader: !!isLeader, is_head: !!isHead, leader_code: leaderCode, status,
      invite_link_id: linkId, reg_type: regType.name,
    }, user?.id, opts.reason || null);
    await audit(user, method === 'manual' ? 'person.create_manual' : 'person.register_invite', 'person', id,
      { head_id: head.id, inviter_id: inviter?.id ?? null, is_leader: !!isLeader, is_head: !!isHead, link_id: linkId }, ip);
    return await getPerson(id);
  });
}

/**
 * Registro público mediante enlace. Cabeza, invitador y tipo se derivan SIEMPRE del token en el servidor.
 * Según el tipo del enlace se registra una persona, un líder (con su enlace y su panel) o una nueva estructura
 * cuya cabeza es quien se registra (invita líderes y personas desde su panel).
 */
export async function registerViaInvite(token, body, ip) {
  const { link, owner, head, type, role, valid, reason } = await resolveInvite(token);
  if (!valid) throw badRequest('LINK_INVALID', reason);
  if (body.website) throw badRequest('SPAM', 'No se pudo procesar el registro.'); // honeypot
  if (!body.consent) throw badRequest('CONSENT_REQUIRED', 'Debe aceptar el tratamiento de datos para registrarse.', { field: 'consent' });
  const data = {
    full_name: body.full_name, first_names: body.first_names, last_names: body.last_names, document_id: body.document_id,
    address: body.address, phone: body.phone, email: body.email, location: body.location, supports: body.supports,
    requireSupports: true,
  };
  const common = { data, method: 'invitation', linkId: link.id, consent: true, ip, regTypeId: type.id };
  return await tx(async () => {
    // Se bloquea el enlace y se vuelve a comprobar dentro de la transacción: dos registros simultáneos con un enlace
    // de un solo uso (o con su último cupo) no pueden pasar ambos.
    const locked = await q('SELECT * FROM invite_links WHERE id = ? FOR UPDATE').get(link.id);
    if (locked.status !== 'active') {
      throw badRequest('LINK_INVALID', locked.disabled_reason === 'auto:usado' ? 'Este enlace ya fue usado: es personal y sirve para un solo registro.' : 'Este enlace fue desactivado.');
    }
    if (locked.expires_at && locked.expires_at < now()) throw badRequest('LINK_INVALID', 'Este enlace ha caducado.');
    if (locked.max_uses != null) {
      const used = (await q(`SELECT COUNT(*) n FROM people WHERE invite_link_id = ? AND status <> 'rejected'`).get(link.id)).n;
      if (used >= locked.max_uses) throw badRequest('LINK_INVALID', 'Este enlace alcanzó su límite de registros.');
    }
    let person;
    let targetHead = head;
    if (role === 'head') {
      // Se valida antes de crear la cabeza; si algo falla después, la transacción la deshace.
      validatePersonData(data);
      const { full_name } = validateNames(data);
      targetHead = await createHeadRecord({ name: `${type.name} ${full_name}`, color: type.color, description: `Registrada con el enlace ${link.token}` });
      await audit(null, 'head.create_via_link', 'head', targetHead.id, { link_id: link.id, reg_type: type.name }, ip);
      person = await createPerson({ ...common, headId: targetHead.id, inviterId: null, isHead: true, status: 'active' });
    } else {
      person = await createPerson({
        ...common, headId: head.id, inviterId: owner?.id ?? null, isLeader: role === 'leader',
        status: head.requires_approval ? 'pending' : 'active',
      });
    }
    if (locked.one_time) {
      // Usado: queda apagado para siempre, aunque después se rechace el registro.
      // Una invitación preparada que alguien usa cuenta como enviada y usada.
      await q(`UPDATE invite_links SET status = 'disabled', used_at = ?, disabled_at = ?, disabled_reason = 'auto:usado', prepared = 0, prepared_key = NULL
               WHERE id = ?`).run(now(), now(), link.id);
    }
    const panelToken = person.is_leader ? await issuePanelToken(person.id) : null;
    return { person, owner, head: targetHead, type, role, panelToken };
  });
}

// ---------------------------------------------------------------------------
// Responsabilidad de líderes
// ---------------------------------------------------------------------------

/**
 * Recalcula el líder responsable de una rama: los registros en modo automático
 * toman el líder oficial más cercano en su cadena de invitación.
 * Devuelve el número de personas cuyo líder cambió.
 */
export async function recomputeLeaders(rootId, userId = null, reason = null) {
  const root = await getPerson(rootId);
  const rows = await q(`SELECT id, inviter_id, is_leader, leader_mode, leader_id, head_id, status FROM people
                   WHERE path >= ? AND path < ? ORDER BY depth`).all(root.path, pathUpper(root.path));
  const above = new Map(); // id -> líder más cercano estrictamente por encima
  const byId = new Map(rows.map((r) => [r.id, r]));
  let changed = 0;
  const upd = await q('UPDATE people SET leader_id = ?, leader_mode = ?, updated_at = ? WHERE id = ?');
  const ts = now();
  for (const r of rows) {
    let nearest;
    if (r.id === root.id) nearest = await nearestLeaderFromPath(root.path, true);
    else {
      const parent = byId.get(r.inviter_id);
      nearest = parent.is_leader ? parent.id : above.get(parent.id);
    }
    above.set(r.id, nearest ?? null);
    let target = r.leader_id;
    let mode = r.leader_mode;
    if (mode === 'manual') {
      const l = r.leader_id ? await getPerson(r.leader_id) : null;
      if (!l || !l.is_leader || l.head_id !== r.head_id) { mode = 'auto'; target = nearest ?? null; }
    } else {
      target = nearest ?? null;
    }
    if (target !== r.leader_id || mode !== r.leader_mode) {
      upd.run(target, mode, ts, r.id);
      await history(r.id, 'leader_changed', { from: r.leader_id, to: target, mode, automatic: true }, userId, reason);
      changed++;
    }
  }
  return changed;
}

export async function promoteToLeader(personId, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    if (p.is_leader) throw badRequest('ALREADY_LEADER', 'La persona ya es líder oficial.');
    if (p.status !== 'active') throw badRequest('NOT_ACTIVE', 'Sólo se puede designar como líder a una persona activa.');
    const code = await generateLeaderCode(p.full_name);
    await q(`UPDATE people SET is_leader = 1, leader_code = ?, leader_since = ?, updated_at = ?,
        reg_type_id = CASE WHEN (SELECT role FROM reg_types WHERE id = people.reg_type_id) = 'person' OR reg_type_id IS NULL
                           THEN (SELECT id FROM reg_types WHERE builtin = 1 AND role = 'leader') ELSE reg_type_id END
        WHERE id = ?`).run(code, now(), now(), p.id);
    const updated = await getPerson(p.id);
    await createLink(updated, 'leader', user?.id);
    // Su invitación personal deja de ser necesaria: el enlace de líder la sustituye.
    await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:promoted'
        WHERE owner_person_id = ? AND kind = 'person' AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    await history(p.id, 'promoted_leader', { leader_code: code }, user?.id, reason);
    // Si tiene cuenta de persona registrada, pasa a cuenta de líder (permiso formal, sólo por designación).
    await q(`UPDATE users SET role = 'leader' WHERE person_id = ? AND role = 'member'`).run(p.id);
    const affected = await recomputeLeaders(p.id, user?.id, `Designación de ${p.full_name} como líder`);
    await audit(user, 'person.promote_leader', 'person', p.id, { leader_code: code, affected }, ip);
    return { person: await getPerson(p.id), affected };
  });
}

export async function demoteLeader(personId, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    if (!p.is_leader) throw badRequest('NOT_LEADER', 'La persona no es líder.');
    if (p.is_head) throw badRequest('HEAD_PERSON', 'Es la cabeza de su estructura: primero quítele el papel de cabeza.');
    if (!p.inviter_id) {
      throw badRequest('ROOT_LEADER', 'Es un líder raíz de la cabeza: antes de retirarle el liderazgo debe moverlo debajo de otra persona.');
    }
    await q(`UPDATE people SET is_leader = 0, leader_since = NULL, updated_at = ?, panel_token_hash = NULL, panel_created_at = NULL,
        reg_type_id = (SELECT id FROM reg_types WHERE builtin = 1 AND role = 'person') WHERE id = ?`).run(now(), p.id);
    await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:demoted'
        WHERE owner_person_id = ? AND kind = 'leader' AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    await history(p.id, 'demoted_leader', { leader_code: p.leader_code }, user?.id, reason);
    await q(`UPDATE users SET role = 'member' WHERE person_id = ? AND role = 'leader'`).run(p.id);
    // Personas asignadas manualmente a este líder vuelven a modo automático.
    const manual = await q(`SELECT id FROM people WHERE leader_id = ? AND leader_mode = 'manual'`).all(p.id);
    for (const m of manual) {
      await q(`UPDATE people SET leader_mode = 'auto' WHERE id = ?`).run(m.id);
    }
    let affected = await recomputeLeaders(p.id, user?.id, `Retiro de liderazgo de ${p.full_name}`);
    for (const m of manual) affected += await recomputeLeaders(m.id, user?.id, `Retiro de liderazgo de ${p.full_name}`);
    await ensurePersonLink(await getPerson(p.id), user?.id);
    await audit(user, 'person.demote_leader', 'person', p.id, { affected }, ip);
    return { person: await getPerson(p.id), affected };
  });
}

/** Asigna manualmente un líder responsable (o vuelve a automático con leaderId = null). */
export async function setResponsibleLeader(personId, leaderId, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    const before = p.leader_id;
    if (leaderId) {
      const l = await getPerson(leaderId);
      if (!l || !l.is_leader || l.head_id !== p.head_id || l.status === 'rejected') {
        throw badRequest('LEADER_INVALID', 'El líder responsable debe ser un líder oficial de la misma cabeza.');
      }
      if (l.id === p.id) throw badRequest('LEADER_INVALID', 'Una persona no puede ser su propio líder responsable.');
      await q(`UPDATE people SET leader_id = ?, leader_mode = 'manual', updated_at = ? WHERE id = ?`).run(l.id, now(), p.id);
      await history(p.id, 'leader_changed', { from: before, to: l.id, mode: 'manual' }, user?.id, reason);
    } else {
      const nearest = await nearestLeaderFromPath(p.path, true);
      await q(`UPDATE people SET leader_id = ?, leader_mode = 'auto', updated_at = ? WHERE id = ?`).run(nearest, now(), p.id);
      await history(p.id, 'leader_changed', { from: before, to: nearest, mode: 'auto' }, user?.id, reason);
    }
    await audit(user, 'person.set_leader', 'person', p.id, { from: before, to: leaderId ?? 'auto' }, ip);
    return await getPerson(p.id);
  });
}

/**
 * Designa (o retira) a la cabeza de una estructura. La cabeza es un líder raíz: al designarla, los demás
 * líderes que colgaban directamente de la estructura pasan a colgar de ella con sus ramas.
 */
export async function setHeadRole(personId, makeHead, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    if (!makeHead) {
      if (!p.is_head) throw badRequest('NOT_HEAD', 'No es la cabeza de su estructura.');
      await q(`UPDATE people SET is_head = 0, updated_at = ?,
          reg_type_id = (SELECT id FROM reg_types WHERE builtin = 1 AND role = 'leader') WHERE id = ?`).run(now(), p.id);
      await history(p.id, 'head_removed', {}, user?.id, reason);
      await audit(user, 'person.head_removed', 'person', p.id, {}, ip);
      return { person: await getPerson(p.id), adopted: 0 };
    }
    if (p.is_head) throw badRequest('ALREADY_HEAD', 'Ya es la cabeza de su estructura.');
    if (p.status !== 'active') throw badRequest('NOT_ACTIVE', 'Sólo una persona activa puede ser cabeza.');
    if (!p.is_leader || p.inviter_id) {
      throw badRequest('NOT_ROOT', 'La cabeza es la raíz de su estructura: elija un líder que cuelgue directamente de ella (puede moverlo antes).');
    }
    const current = await headPerson(p.head_id);
    if (current) throw badRequest('HEAD_TAKEN', `La estructura ya tiene cabeza: ${current.full_name}.`);
    await q(`UPDATE people SET is_head = 1, updated_at = ?,
        reg_type_id = CASE WHEN (SELECT role FROM reg_types WHERE id = people.reg_type_id) = 'head' THEN reg_type_id
                           ELSE (SELECT id FROM reg_types WHERE builtin = 1 AND role = 'head') END WHERE id = ?`).run(now(), p.id);
    const adopted = await adoptRootLeaders(sqlExec, { id: p.id, head_id: p.head_id, path: p.path },
      { userId: user?.id ?? null, reason: `${p.full_name} es la cabeza de la estructura` });
    await history(p.id, 'head_assigned', { adopted: adopted.length }, user?.id, reason);
    await audit(user, 'person.head_assigned', 'person', p.id, { adopted }, ip);
    return { person: await getPerson(p.id), adopted: adopted.length };
  });
}

// ---------------------------------------------------------------------------
// Movimientos (procedimiento autorizado con historial)
// ---------------------------------------------------------------------------

/**
 * Mueve a una persona (con toda su rama) bajo otro invitador, en la misma u otra cabeza.
 * newInviterId = null => la persona (que debe ser líder) pasa a colgar directamente de la estructura destino:
 * de su cabeza, si la tiene. La cabeza de una estructura no se mueve.
 */
export async function movePerson(personId, { newInviterId = null, newHeadId = null }, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    if (p.status === 'rejected') throw badRequest('INVALID_STATE', 'No se puede mover un registro rechazado.');
    if (p.is_head) throw badRequest('HEAD_PERSON', 'Es la cabeza de su estructura: no se mueve. Si debe cambiar, quítele primero el papel de cabeza.');
    if (!reason || String(reason).trim().length < 5) throw badRequest('REASON_REQUIRED', 'Debe indicar el motivo del movimiento (mín. 5 caracteres).', { field: 'reason' });
    if (!newInviterId && p.is_leader) {
      const cabeza = await headPerson(Number(newHeadId || p.head_id));
      if (cabeza && cabeza.status === 'active' && cabeza.id !== p.id) newInviterId = cabeza.id;
    }
    let target = null;
    let headId;
    if (newInviterId) {
      target = await getPerson(newInviterId);
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
    const head = await getHead(headId);
    if (!head || head.status !== 'active') throw badRequest('VALIDATION', 'La cabeza destino no es válida.');
    if ((target?.id ?? null) === p.inviter_id && headId === p.head_id) throw badRequest('NO_CHANGE', 'La persona ya está en esa posición.');

    const oldPath = p.path;
    const branchSize = 1 + p.descendant_count;
    // Contadores: se retira la rama de sus antiguos ancestros y se suma a los nuevos.
    if (p.inviter_id) await bumpCounts(oldPath.slice(0, oldPath.length - String(p.id).length - 1), -branchSize, p.inviter_id);
    if (target) await bumpCounts(target.path, branchSize, target.id);
    const newPath = `${target ? target.path : '/'}${p.id}/`;
    const deltaDepth = (target ? target.depth + 1 : 0) - p.depth;
    const crossHead = headId !== p.head_id;
    const subtree = (await q('SELECT id FROM people WHERE path >= ? AND path < ?').all(oldPath, pathUpper(oldPath))).map((r) => r.id);
    const longest = (await q('SELECT MAX(LENGTH(path)) AS m FROM people WHERE path >= ? AND path < ?').get(oldPath, pathUpper(oldPath))).m;
    if (longest - oldPath.length + newPath.length > MAX_PATH) throw badRequest('TOO_DEEP', 'El movimiento superaría la profundidad máxima permitida.');

    await q(`UPDATE people SET path = CONCAT(?::text, substr(path, ?::int)), depth = depth + ?::int, head_id = ?, updated_at = ?
        WHERE path >= ? AND path < ?`).run(newPath, oldPath.length + 1, deltaDepth, headId, now(), oldPath, pathUpper(oldPath));
    await q('UPDATE people SET inviter_id = ? WHERE id = ?').run(target?.id ?? null, p.id);

    await history(p.id, crossHead ? 'moved_head' : 'moved', {
      from_head_id: p.head_id, to_head_id: headId, from_inviter_id: p.inviter_id, to_inviter_id: target?.id ?? null,
      branch_size: subtree.length,
    }, user?.id, reason);
    if (crossHead) {
      for (const id of subtree) {
        if (id !== p.id) await history(id, 'moved_head', { from_head_id: p.head_id, to_head_id: headId, via_branch_of: p.id }, user?.id, reason);
      }
    }
    const affected = await recomputeLeaders(p.id, user?.id, `Movimiento de rama: ${reason}`);
    await audit(user, crossHead ? 'person.move_head' : 'person.move', 'person', p.id, {
      from_head_id: p.head_id, to_head_id: headId, from_inviter_id: p.inviter_id, to_inviter_id: target?.id ?? null,
      branch_size: subtree.length, leaders_recomputed: affected,
    }, ip);
    return { person: await getPerson(p.id), branchSize: subtree.length, affected };
  });
}

// ---------------------------------------------------------------------------
// Estado y datos
// ---------------------------------------------------------------------------

export async function setStatus(personId, status, user, reason, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
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
      const kids = (await q(`SELECT COUNT(*) n FROM people WHERE inviter_id = ? AND status <> 'rejected'`).get(p.id)).n;
      if (kids) throw badRequest('HAS_CHILDREN', 'No se puede rechazar a una persona que ya tiene invitados.');
      if (p.is_leader) throw badRequest('INVALID_TRANSITION', 'No se puede rechazar a un líder.');
    }
    if (status === 'active') await assertNoDuplicate(p, p.id);
    await q('UPDATE people SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), p.id);
    if (status === 'rejected' && p.inviter_id) {
      // Un registro rechazado deja de contar en la rama (no tiene invitados: se comprobó arriba).
      await bumpCounts(p.path.slice(0, p.path.length - String(p.id).length - 1), -1, p.inviter_id);
    }
    if (status === 'inactive') {
      await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'auto:person_inactive'
          WHERE owner_person_id = ? AND status = 'active'`).run(now(), user?.id ?? null, p.id);
    }
    if (status === 'active') {
      if (p.is_leader) {
        const l = await q(`SELECT id FROM invite_links WHERE owner_person_id = ? AND kind = 'leader' AND disabled_reason = 'auto:person_inactive' ORDER BY id DESC LIMIT 1`).get(p.id);
        if (l) await q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
      }
      await ensurePersonLink(await getPerson(p.id), user?.id);
    }
    const type = { active: p.status === 'pending' ? 'approved' : 'reactivated', inactive: 'deactivated', rejected: 'rejected' }[status];
    await history(p.id, type, { from: p.status, to: status }, user?.id, reason);
    await audit(user, `person.${type}`, 'person', p.id, { from: p.status, to: status }, ip);
    return await getPerson(p.id);
  });
}

export async function updatePersonData(personId, body, user, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    const nameParts = body.first_names !== undefined || body.last_names !== undefined
      ? { first_names: body.first_names ?? p.first_names ?? '', last_names: body.last_names ?? p.last_names ?? '' }
      : { full_name: body.full_name ?? p.full_name, keepNames: body.full_name === undefined ? p : null };
    const merged = {
      ...nameParts,
      supports: body.supports !== undefined ? body.supports : p.supports,
      secure_vote: body.secure_vote !== undefined ? body.secure_vote : p.secure_vote,
      phone: body.phone ?? p.phone,
      email: body.email !== undefined ? body.email : p.email,
      document_id: body.document_id !== undefined ? body.document_id : p.document_id,
      address: body.address !== undefined ? body.address : p.address,
      city: body.city ?? p.city,
      notes: body.notes ?? p.notes,
    };
    // Registros antiguos (sin cédula/dirección) pueden editarse; los nuevos mantienen los obligatorios.
    const data = validatePersonData(merged, { legacy: { document_id: p.document_id, address: p.address, phone_changed: body.phone !== undefined && normalizePhone(body.phone) !== p.phone } });
    data.reg_type_id = body.reg_type_id !== undefined && body.reg_type_id !== null && body.reg_type_id !== '' && Number(body.reg_type_id) !== p.reg_type_id
      ? (await typeFor(Number(body.reg_type_id), roleOf(p))).id : p.reg_type_id;
    if (data.email && data.email !== p.email) await assertEmailDomain(data.email, { enabled: EMAIL_DNS });
    if (p.status !== 'rejected') await assertNoDuplicate(data, p.id);
    const changes = {};
    for (const k of Object.keys(data)) {
      if ((data[k] ?? null) !== (p[k] ?? null)) changes[k] = { from: p[k] ?? null, to: data[k] ?? null };
    }
    if (!Object.keys(changes).length) return p;
    await q(`UPDATE people SET full_name = ?, name_key = ?, phone = ?, email = ?, document_id = ?, address = ?, city = ?, notes = ?,
        first_names = ?, last_names = ?, supports = ?, reg_type_id = ?, secure_vote = ?, updated_at = ? WHERE id = ?`).run(data.full_name,
      normalizeText(data.full_name), data.phone, data.email, data.document_id, data.address, data.city, data.notes, data.first_names, data.last_names, data.supports,
      data.reg_type_id, data.secure_vote, now(), p.id);
    await history(p.id, 'data_updated', { fields: changes }, user?.id, body.reason || null);
    await audit(user, 'person.update', 'person', p.id, { fields: Object.keys(changes) }, ip);
    return await getPerson(p.id);
  });
}

/** Genera (o regenera) la invitación personal de una persona. */
export async function regeneratePersonLink(personId, user, ip) {
  return await tx(async () => {
    const p = await getPerson(personId);
    if (!p) throw notFound();
    if (p.status !== 'active') throw badRequest('NOT_ACTIVE', 'La persona no está activa.');
    const kind = p.is_leader ? 'leader' : 'person';
    if (kind === 'person' && !(await getHead(p.head_id)).person_invites_enabled) {
      throw forbidden('Las invitaciones personales están deshabilitadas en esta cabeza.');
    }
    await q(`UPDATE invite_links SET status = 'disabled', disabled_at = ?, disabled_by = ?, disabled_reason = 'Regenerado'
        WHERE owner_person_id = ? AND kind = ? AND status = 'active'`).run(now(), user?.id ?? null, p.id, kind);
    let id;
    if (kind === 'leader') {
      // El código de líder es estable; se reactiva el enlace con ese token si existe.
      const l = await q(`SELECT id FROM invite_links WHERE token = ?`).get(p.leader_code);
      if (l) {
        await q(`UPDATE invite_links SET status = 'active', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = ?`).run(l.id);
        id = l.id;
      } else id = await createLink(p, 'leader', user?.id);
    } else id = await createLink(p, 'person', user?.id);
    await audit(user, 'link.regenerate', 'invite_link', id, { person_id: p.id, kind }, ip);
    await history(p.id, 'link_regenerated', { kind, link_id: id }, user?.id);
    return await q('SELECT * FROM invite_links WHERE id = ?').get(id);
  });
}

// ---------------------------------------------------------------------------
// Verificación de integridad
// ---------------------------------------------------------------------------

export async function integrityReport() {
  const issues = [];
  const add = (type, rows, msg) => rows.forEach((r) => issues.push({ type, person_id: r.id, message: msg }));
  add('path', await q(`SELECT c.id FROM people c LEFT JOIN people i ON i.id = c.inviter_id
                 WHERE c.path <> CONCAT(COALESCE(i.path, '/'), c.id, '/')`).all(), 'Ruta de árbol inconsistente');
  add('depth', await q(`SELECT c.id FROM people c LEFT JOIN people i ON i.id = c.inviter_id
                  WHERE c.depth <> COALESCE(i.depth + 1, 0)`).all(), 'Profundidad inconsistente');
  add('head', await q(`SELECT c.id FROM people c JOIN people i ON i.id = c.inviter_id WHERE c.head_id <> i.head_id`).all(),
    'Pertenece a una cabeza distinta de la de su invitador');
  add('leader', await q(`SELECT c.id FROM people c JOIN people l ON l.id = c.leader_id
                   WHERE l.is_leader = 0 OR l.head_id <> c.head_id`).all(), 'Líder responsable inválido');
  add('root', await q(`SELECT id FROM people WHERE inviter_id IS NULL AND is_leader = 0 AND status <> 'rejected'`).all(),
    'Persona sin invitador que no es líder');
  add('dup_phone', await q(`SELECT MIN(id) id FROM people WHERE status <> 'rejected' GROUP BY phone HAVING COUNT(*) > 1`).all(), 'Teléfono duplicado');
  // Auto-asignación: el líder debe coincidir con el líder más cercano en la cadena.
  const autos = await q(`SELECT id, path, leader_id FROM people WHERE leader_mode = 'auto'`).all();
  if (autos.length <= 50000) {
    const leaders = new Set((await q('SELECT id FROM people WHERE is_leader = 1').all()).map((r) => r.id));
    for (const a of autos) {
      const ids = ancestorIds(a.path); ids.pop();
      let nearest = null;
      for (let i = ids.length - 1; i >= 0; i--) if (leaders.has(ids[i])) { nearest = ids[i]; break; }
      if (nearest !== a.leader_id) issues.push({ type: 'leader_auto', person_id: a.id, message: 'Líder automático desactualizado' });
    }
  }
  for (const d of await counterDrift()) issues.push({ type: 'counters', person_id: d.id, message: 'Contadores de rama desactualizados' });
  for (const g of await geoIntegrity()) issues.push({ type: 'geo', person_id: g.id, message: 'Ubicación geográfica inconsistente' });
  return { ok: issues.length === 0, checked_at: now(), issues: issues.slice(0, 500), total_issues: issues.length };
}

/** Recalcula en memoria los contadores reales y devuelve los nodos cuyo valor guardado difiere. */
async function counterDrift() {
  const rows = await q(`SELECT id, path, inviter_id, child_count, descendant_count FROM people WHERE status <> 'rejected'`).all();
  const desc = new Map(); const kids = new Map();
  for (const r of rows) {
    const ids = ancestorIds(r.path); ids.pop();
    for (const a of ids) desc.set(a, (desc.get(a) || 0) + 1);
    if (r.inviter_id) kids.set(r.inviter_id, (kids.get(r.inviter_id) || 0) + 1);
  }
  return rows
    .map((r) => ({ id: r.id, child: kids.get(r.id) || 0, desc: desc.get(r.id) || 0, r }))
    .filter((x) => x.child !== x.r.child_count || x.desc !== x.r.descendant_count);
}

/** Repara contadores desactualizados (no debería ser necesario; queda como herramienta de mantenimiento). */
export async function recountCounters(user, ip) {
  return tx(async () => {
    const drift = await counterDrift();
    for (const d of drift) {
      await q('UPDATE people SET child_count = ?, descendant_count = ? WHERE id = ?').run(d.child, d.desc, d.id);
    }
    await audit(user, 'admin.recount', 'people', null, { fixed: drift.length }, ip);
    return { fixed: drift.length };
  });
}
