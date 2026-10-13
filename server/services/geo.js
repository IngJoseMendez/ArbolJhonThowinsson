// Catálogo geográfico (Localidad → Comuna/Corregimiento → Barrio/Vereda) y ubicación de personas.
// Las ubicaciones escritas a mano se guardan aparte (geo_*_text) y marcan la persona como
// "pendiente de verificación geográfica"; nunca crean entradas del catálogo sin revisión.
import { q, tx, now } from '../db.js';
import { badRequest, notFound, normalizeText, str } from '../util.js';
import { audit, history } from './audit.js';

export const LEVELS = ['localidad', 'comuna', 'barrio'];
const PARENT = { comuna: 'localidad', barrio: 'comuna' };
const KINDS = { localidad: ['localidad'], comuna: ['comuna', 'corregimiento'], barrio: ['barrio', 'vereda'] };

export const AREA_COLS = 'id, level, kind, code, name, alias, parent_id, source, active';

export async function getArea(id) {
  return q(`SELECT ${AREA_COLS} FROM geo_areas WHERE id = ?`).get(id);
}

/** Opciones de un nivel, opcionalmente filtradas por padre y texto (para los selectores). */
export async function listAreas({ level, parentId = null, localidadId = null, term = '', includeInactive = false, limit = 500 } = {}) {
  if (localidadId) {
    // Barrios y veredas de una localidad, con su comuna o corregimiento (que se deduce al elegir el barrio).
    return q(`SELECT ${AREA_COLS.split(', ').map((c) => `b.${c}`).join(', ')}, c.name AS parent_name, c.kind AS parent_kind, c.alias AS parent_alias
               FROM geo_areas b JOIN geo_areas c ON c.id = b.parent_id
              WHERE b.level = 'barrio' AND c.parent_id = ? ${includeInactive ? '' : 'AND b.active = 1 AND c.active = 1'}
              ORDER BY b.name_key, c.name_key LIMIT ?`).all(localidadId, limit);
  }
  const where = [];
  const params = [];
  if (level) { where.push('level = ?'); params.push(level); }
  if (parentId) { where.push('parent_id = ?'); params.push(parentId); }
  if (!includeInactive) where.push('active = 1');
  if (term) {
    where.push('(name_key LIKE ? OR lower(alias) LIKE ?)');
    params.push(`%${normalizeText(term)}%`, `%${String(term).toLowerCase()}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return q(`SELECT ${AREA_COLS} FROM geo_areas ${w}
             ORDER BY level, (CASE WHEN code ~ '^[LC][0-9]+$' THEN substr(code, 2)::int ELSE 999 END), kind, name_key LIMIT ?`)
    .all(...params, limit);
}

/**
 * Valida la ubicación recibida y devuelve las columnas a guardar en `people`.
 * input: { localidad_id | localidad_text, comuna_id | comuna_text, barrio_id | barrio_text }
 */
export async function resolveLocation(input, { required = true } = {}) {
  const loc = { ...(input || {}) };
  // Formulario sin comuna: si se elige un barrio del catálogo, su comuna o corregimiento se deduce.
  if (loc.barrio_id && !loc.comuna_id && !loc.comuna_text) {
    const b = await getArea(Number(loc.barrio_id));
    if (b?.level === 'barrio') loc.comuna_id = b.parent_id;
  }
  const out = {
    geo_localidad_id: null, geo_comuna_id: null, geo_barrio_id: null,
    geo_localidad_text: null, geo_comuna_text: null, geo_barrio_text: null, geo_status: 'none',
  };
  const text = (v, field, key) => str(v, { field, key, max: 120 }) || null;
  const id = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  let parent = null; // área de catálogo del nivel anterior (o null si fue manual / vacío)
  let parentManual = false;
  let anyValue = false;
  for (const level of LEVELS) {
    const label = level === 'localidad' ? 'localidad' : level === 'comuna' ? 'comuna o corregimiento' : 'barrio o vereda';
    const areaId = id(loc[`${level}_id`]);
    const manual = text(loc[`${level}_text`], label, level);
    if (areaId && manual) throw badRequest('VALIDATION', `Indique la ${label} del listado o escríbala, no ambas.`, { field: level });
    if (areaId) {
      if (parentManual) throw badRequest('VALIDATION', `La ${label} debe escribirse porque el nivel superior no está en el catálogo.`, { field: level });
      if (level !== 'localidad' && !parent) throw badRequest('VALIDATION', `Seleccione primero la ${level === 'comuna' ? 'localidad' : 'comuna'}.`, { field: level });
      const a = await getArea(areaId);
      if (!a || a.level !== level || !a.active) throw badRequest('VALIDATION', `La ${label} seleccionada no es válida.`, { field: level });
      if (level !== 'localidad' && a.parent_id !== parent.id) {
        throw badRequest('GEO_MISMATCH', `La ${label} seleccionada no pertenece a la ${PARENT[level]} elegida.`, { field: level });
      }
      out[`geo_${level}_id`] = a.id;
      parent = a;
      anyValue = true;
    } else if (manual) {
      if (level !== 'localidad' && !parent && !parentManual) {
        throw badRequest('VALIDATION', `Indique primero la ${level === 'comuna' ? 'localidad' : 'comuna'}.`, { field: level });
      }
      out[`geo_${level}_text`] = manual;
      parent = null;
      parentManual = true;
      anyValue = true;
    } else {
      // Niveles inferiores vacíos: se admite (sólo la localidad es obligatoria), pero no "saltarse" un nivel.
      // Excepción: barrio escrito a mano sin comuna (el formulario sólo pide localidad y barrio).
      if (level === 'comuna' && loc.barrio_text && !loc.barrio_id) continue;
      const below = LEVELS.slice(LEVELS.indexOf(level) + 1).some((l) => loc[`${l}_id`] || loc[`${l}_text`]);
      if (below) throw badRequest('VALIDATION', `Indique primero la ${label}.`, { field: level });
      if (level === 'localidad' && required) throw badRequest('VALIDATION', 'La localidad es obligatoria.', { field: 'localidad' });
      break;
    }
  }
  if (!anyValue) return out;
  out.geo_status = out.geo_localidad_text || out.geo_comuna_text || out.geo_barrio_text ? 'pending' : 'verified';
  return out;
}

/** Cambia la ubicación de una persona (corrección administrativa), con historial. */
export async function setPersonLocation(personId, input, user, reason, ip) {
  return tx(async () => {
    const p = await q('SELECT * FROM people WHERE id = ?').get(personId);
    if (!p) throw notFound();
    const cols = await resolveLocation(input);
    const before = pickGeo(p);
    await q(`UPDATE people SET geo_localidad_id = ?, geo_comuna_id = ?, geo_barrio_id = ?, geo_localidad_text = ?,
              geo_comuna_text = ?, geo_barrio_text = ?, geo_status = ?, updated_at = ? WHERE id = ?`).run(
      cols.geo_localidad_id, cols.geo_comuna_id, cols.geo_barrio_id, cols.geo_localidad_text, cols.geo_comuna_text,
      cols.geo_barrio_text, cols.geo_status, now(), p.id);
    await history(p.id, 'location_changed', { from: before, to: cols }, user?.id, reason || null);
    await audit(user, 'person.location', 'person', p.id, { to: cols }, ip);
    return cols;
  });
}

const pickGeo = (p) => ({
  geo_localidad_id: p.geo_localidad_id, geo_comuna_id: p.geo_comuna_id, geo_barrio_id: p.geo_barrio_id,
  geo_localidad_text: p.geo_localidad_text, geo_comuna_text: p.geo_comuna_text, geo_barrio_text: p.geo_barrio_text,
  geo_status: p.geo_status,
});

// ---------------------------------------------------------------------------
// Administración del catálogo
// ---------------------------------------------------------------------------

function validateAreaInput(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { field: 'nombre', required: true, min: 2, max: 120 });
  if (body.alias !== undefined) out.alias = str(body.alias, { field: 'descripción', max: 120 });
  if (body.source !== undefined) out.source = str(body.source, { field: 'fuente', max: 20 }) || 'ADMIN';
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (body.kind !== undefined) out.kind = String(body.kind);
  return out;
}

async function assertParent(level, parentId) {
  if (level === 'localidad') {
    if (parentId) throw badRequest('VALIDATION', 'Una localidad no tiene nivel superior.');
    return null;
  }
  const parent = parentId ? await getArea(parentId) : null;
  if (!parent || parent.level !== PARENT[level]) {
    throw badRequest('VALIDATION', `Seleccione la ${PARENT[level]} a la que pertenece.`, { field: 'parent_id' });
  }
  return parent;
}

async function assertUniqueName(level, parentId, name, exceptId = null) {
  const dup = await q(`SELECT id, name FROM geo_areas WHERE level = ? AND COALESCE(parent_id, 0) = ? AND name_key = ?
                        AND id IS DISTINCT FROM ?::int`).get(level, parentId || 0, normalizeText(name), exceptId);
  if (dup) throw badRequest('DUPLICATE', `Ya existe "${dup.name}" en ese mismo nivel.`, { existing_id: dup.id });
}

export async function createArea(body, user, ip) {
  return tx(async () => {
    const level = String(body.level || '');
    if (!LEVELS.includes(level)) throw badRequest('VALIDATION', 'Nivel no válido.');
    const d = validateAreaInput(body);
    const kind = d.kind || KINDS[level][0];
    if (!KINDS[level].includes(kind)) throw badRequest('VALIDATION', 'Tipo no válido para ese nivel.');
    const parentId = body.parent_id ? Number(body.parent_id) : null;
    await assertParent(level, parentId);
    await assertUniqueName(level, parentId, d.name);
    const r = await q(`INSERT INTO geo_areas (level, kind, name, name_key, alias, parent_id, source) VALUES (?,?,?,?,?,?,?)`)
      .run(level, kind, d.name, normalizeText(d.name), d.alias || '', parentId, d.source || 'ADMIN');
    await audit(user, 'geo.create', 'geo_area', r.lastInsertRowid, { level, kind, name: d.name, parent_id: parentId }, ip);
    return getArea(r.lastInsertRowid);
  });
}

export async function updateArea(id, body, user, ip) {
  return tx(async () => {
    const a = await getArea(id);
    if (!a) throw notFound('Ubicación no encontrada.');
    const d = validateAreaInput(body, true);
    if (d.kind && !KINDS[a.level].includes(d.kind)) throw badRequest('VALIDATION', 'Tipo no válido para ese nivel.');
    let parentId = a.parent_id;
    if (body.parent_id !== undefined && Number(body.parent_id || 0) !== (a.parent_id || 0)) {
      parentId = body.parent_id ? Number(body.parent_id) : null;
      await assertParent(a.level, parentId);
      // Las personas ya ubicadas aquí arrastran el cambio de nivel superior para no quedar inconsistentes.
    }
    if (d.name || parentId !== a.parent_id) await assertUniqueName(a.level, parentId, d.name || a.name, a.id);
    const sets = []; const params = [];
    for (const k of ['name', 'alias', 'source', 'active', 'kind']) if (d[k] !== undefined) { sets.push(`${k} = ?`); params.push(d[k]); }
    if (d.name) { sets.push('name_key = ?'); params.push(normalizeText(d.name)); }
    if (parentId !== a.parent_id) { sets.push('parent_id = ?'); params.push(parentId); }
    if (!sets.length) return a;
    await q(`UPDATE geo_areas SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, now(), a.id);
    if (parentId !== a.parent_id) {
      if (a.level === 'barrio') {
        const com = await getArea(parentId);
        await q('UPDATE people SET geo_comuna_id = ?, geo_localidad_id = ? WHERE geo_barrio_id = ?').run(com.id, com.parent_id, a.id);
      } else if (a.level === 'comuna') {
        await q('UPDATE people SET geo_localidad_id = ? WHERE geo_comuna_id = ?').run(parentId, a.id);
      }
    }
    await audit(user, 'geo.update', 'geo_area', a.id, { ...d, parent_id: parentId }, ip);
    return getArea(a.id);
  });
}

/**
 * Importa filas { localidad, comuna, barrio, tipo?, fuente? } creando sólo lo que no existe
 * (comparación por nombre normalizado dentro del mismo nivel superior).
 */
export async function importAreas(rows, user, ip) {
  if (!Array.isArray(rows) || !rows.length) throw badRequest('VALIDATION', 'No hay filas para importar.');
  if (rows.length > 5000) throw badRequest('VALIDATION', 'Máximo 5000 filas por importación.');
  return tx(async () => {
    const stats = { created: 0, existing: 0, errors: [] };
    const cache = new Map();
    const ensure = async (level, name, parentId, kind, source) => {
      const key = `${level}|${parentId || 0}|${normalizeText(name)}`;
      if (cache.has(key)) return cache.get(key);
      let a = await q(`SELECT id FROM geo_areas WHERE level = ? AND COALESCE(parent_id, 0) = ? AND name_key = ?`)
        .get(level, parentId || 0, normalizeText(name));
      if (a) stats.existing++;
      else {
        const k = KINDS[level].includes(kind) ? kind : KINDS[level][0];
        const r = await q(`INSERT INTO geo_areas (level, kind, name, name_key, parent_id, source) VALUES (?,?,?,?,?,?)`)
          .run(level, k, name, normalizeText(name), parentId, source || 'IMPORT');
        a = { id: r.lastInsertRowid };
        stats.created++;
      }
      cache.set(key, a.id);
      return a.id;
    };
    for (const [i, row] of rows.entries()) {
      const l = String(row.localidad || '').trim();
      const c = String(row.comuna || '').trim();
      const b = String(row.barrio || '').trim();
      const tipo = String(row.tipo || '').trim().toLowerCase();
      if (!l) { stats.errors.push({ fila: i + 1, error: 'Falta la localidad' }); continue; }
      if (!c && b) { stats.errors.push({ fila: i + 1, error: 'Hay barrio sin comuna' }); continue; }
      if ([l, c, b].some((x) => x.length > 120)) { stats.errors.push({ fila: i + 1, error: 'Nombre demasiado largo' }); continue; }
      const lid = await ensure('localidad', l, null, 'localidad', row.fuente);
      if (!c) continue;
      const cid = await ensure('comuna', c, lid, tipo === 'corregimiento' || tipo === 'vereda' ? 'corregimiento' : 'comuna', row.fuente);
      if (!b) continue;
      await ensure('barrio', b, cid, tipo === 'vereda' || tipo === 'corregimiento' ? 'vereda' : 'barrio', row.fuente);
    }
    await audit(user, 'geo.import', 'geo_area', null, { rows: rows.length, created: stats.created, existing: stats.existing, errors: stats.errors.length }, ip);
    return stats;
  });
}

// ---------------------------------------------------------------------------
// Revisión de ubicaciones escritas a mano
// ---------------------------------------------------------------------------

/** Agrupa las ubicaciones pendientes por texto escrito y contexto (nivel superior del catálogo). */
export async function pendingGroups(scope) {
  return q(`SELECT
      CASE WHEN p.geo_localidad_text IS NOT NULL THEN 'localidad' WHEN p.geo_comuna_text IS NOT NULL THEN 'comuna' ELSE 'barrio' END AS level,
      p.geo_localidad_id, l.name AS localidad_name, p.geo_comuna_id, c.name AS comuna_name, c.kind AS comuna_kind,
      p.geo_localidad_text, p.geo_comuna_text, p.geo_barrio_text, COUNT(*) AS people,
      MIN(p.created_at) AS first_seen, (array_agg(p.id ORDER BY p.id))[1:20] AS person_ids
    FROM people p LEFT JOIN geo_areas l ON l.id = p.geo_localidad_id LEFT JOIN geo_areas c ON c.id = p.geo_comuna_id
    WHERE p.geo_status = 'pending' AND p.status <> 'rejected' AND ${scope.sql}
    GROUP BY p.geo_localidad_id, l.name, p.geo_comuna_id, c.name, c.kind, p.geo_localidad_text, p.geo_comuna_text, p.geo_barrio_text
    ORDER BY people DESC, first_seen`).all(...scope.params);
}

/**
 * Resuelve un grupo de ubicaciones escritas a mano: asigna a todas las personas del grupo
 * (mismo texto y mismo contexto) la ubicación de catálogo indicada.
 * group: { geo_localidad_id, geo_comuna_id, geo_localidad_text, geo_comuna_text, geo_barrio_text }
 * target: { localidad_id, comuna_id, barrio_id } (y opcionalmente *_text para niveles que sigan sin catálogo)
 */
export async function resolvePendingGroup(group, target, scope, user, ip) {
  return tx(async () => {
    const cols = await resolveLocation(target);
    const eq = (col, v) => (v === null || v === undefined ? `${col} IS NULL` : `${col} = ?`);
    const conds = [];
    const params = [];
    for (const [col, v] of [['p.geo_localidad_id', group.geo_localidad_id], ['p.geo_comuna_id', group.geo_comuna_id],
      ['p.geo_localidad_text', group.geo_localidad_text], ['p.geo_comuna_text', group.geo_comuna_text], ['p.geo_barrio_text', group.geo_barrio_text]]) {
      conds.push(eq(col, v ?? null));
      if (v !== null && v !== undefined) params.push(v);
    }
    const people = await q(`SELECT p.id FROM people p WHERE p.geo_status = 'pending' AND ${conds.join(' AND ')} AND ${scope.sql}`)
      .all(...params, ...scope.params);
    for (const { id } of people) {
      await q(`UPDATE people SET geo_localidad_id = ?, geo_comuna_id = ?, geo_barrio_id = ?, geo_localidad_text = ?,
                geo_comuna_text = ?, geo_barrio_text = ?, geo_status = ?, updated_at = ? WHERE id = ?`).run(
        cols.geo_localidad_id, cols.geo_comuna_id, cols.geo_barrio_id, cols.geo_localidad_text, cols.geo_comuna_text,
        cols.geo_barrio_text, cols.geo_status, now(), id);
      await history(id, 'location_verified', { from: group, to: cols }, user?.id, 'Revisión de ubicación escrita a mano');
    }
    await audit(user, 'geo.resolve_pending', 'people', null, { group, to: cols, people: people.length }, ip);
    return { updated: people.length, location: cols };
  });
}

// ---------------------------------------------------------------------------
// Conteos por ubicación
// ---------------------------------------------------------------------------

export async function locationStats(scope, headId = null) {
  const extra = headId ? ' AND p.head_id = ?' : '';
  const params = [...scope.params, ...(headId ? [headId] : [])];
  const base = `FROM people p WHERE p.status <> 'rejected' AND ${scope.sql}${extra}`;
  const count = async (col) => Object.fromEntries((await q(`SELECT ${col} AS id, COUNT(*) AS n ${base} AND ${col} IS NOT NULL GROUP BY ${col}`)
    .all(...params)).map((r) => [r.id, r.n]));
  const [byLocalidad, byComuna, byBarrio] = [await count('p.geo_localidad_id'), await count('p.geo_comuna_id'), await count('p.geo_barrio_id')];
  const totals = await q(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN p.geo_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN p.geo_status = 'none' THEN 1 ELSE 0 END) AS without_location ${base}`).get(...params);
  const areas = await listAreas({ includeInactive: true, limit: 20000 });
  return {
    totals: { total: totals.total || 0, pending: totals.pending || 0, without_location: totals.without_location || 0 },
    areas: areas.map((a) => ({ ...a, people: (a.level === 'localidad' ? byLocalidad : a.level === 'comuna' ? byComuna : byBarrio)[a.id] || 0 })),
  };
}

/** Comprobación de integridad de las ubicaciones asignadas. */
export async function geoIntegrity() {
  return q(`SELECT p.id FROM people p
      LEFT JOIN geo_areas c ON c.id = p.geo_comuna_id LEFT JOIN geo_areas b ON b.id = p.geo_barrio_id
     WHERE (p.geo_comuna_id IS NOT NULL AND c.parent_id IS DISTINCT FROM p.geo_localidad_id)
        OR (p.geo_barrio_id IS NOT NULL AND b.parent_id IS DISTINCT FROM p.geo_comuna_id)
        OR (p.geo_status = 'pending' AND p.geo_localidad_text IS NULL AND p.geo_comuna_text IS NULL AND p.geo_barrio_text IS NULL)
        OR (p.geo_status = 'verified' AND (p.geo_localidad_text IS NOT NULL OR p.geo_comuna_text IS NOT NULL OR p.geo_barrio_text IS NOT NULL))`).all();
}
