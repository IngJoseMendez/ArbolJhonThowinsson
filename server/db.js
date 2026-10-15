// Conexión PostgreSQL (Neon vía Vercel Marketplace en producción; cualquier Postgres 13+ sirve) y esquema.
//
// Relaciones clave de `people` (no deben confundirse):
//   head_id    -> PERTENENCIA: la cabeza a la que pertenece la persona (exactamente una).
//   leader_id  -> RESPONSABILIDAD: el líder oficial responsable (puede ser NULL).
//   inviter_id -> INVITACIÓN DIRECTA: quién invitó realmente a la persona.
//                 NULL sólo para líderes raíz colgados directamente de la cabeza.
//
// El árbol de invitaciones se materializa en `path` ("/1/5/9/", colación "C") para consultar
// ramas completas con un rango indexado, sin recursión. `child_count` y `descendant_count`
// se mantienen en la misma transacción que cada alta, rechazo o movimiento, de modo que el
// árbol nunca recuenta ramas enteras al dibujarse.
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import SANTA_MARTA from './data/santa-marta.js';

// COUNT/SUM devuelven bigint/numeric: se convierten a número de JavaScript.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const TS = `to_char(timezone('UTC', clock_timestamp()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS heads (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80) NOT NULL,
  slug          VARCHAR(80) NOT NULL UNIQUE,
  description   VARCHAR(500) NOT NULL DEFAULT '',
  region        VARCHAR(80) NOT NULL DEFAULT '',
  color         CHAR(7) NOT NULL DEFAULT '#2a78d6',
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  requires_approval SMALLINT NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
  person_invites_enabled SMALLINT NOT NULL DEFAULT 1 CHECK (person_invites_enabled IN (0,1)),
  created_by    INT,
  created_at    TEXT NOT NULL DEFAULT ${TS},
  updated_at    TEXT NOT NULL DEFAULT ${TS}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_heads_name ON heads (lower(name));

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(60) NOT NULL,
  display_name  VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('super_admin','head_admin','leader','member')),
  person_id     INT UNIQUE,
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL DEFAULT ${TS},
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS people (
  id               SERIAL PRIMARY KEY,
  code             VARCHAR(40) NOT NULL UNIQUE,
  full_name        VARCHAR(120) NOT NULL,
  name_key         VARCHAR(120) NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  email            VARCHAR(160),
  document_id      VARCHAR(30),
  city             VARCHAR(80) NOT NULL DEFAULT '',
  notes            VARCHAR(500) NOT NULL DEFAULT '',
  head_id          INT NOT NULL REFERENCES heads(id),
  inviter_id       INT REFERENCES people(id),
  leader_id        INT REFERENCES people(id),
  leader_mode      VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (leader_mode IN ('auto','manual')),
  is_leader        SMALLINT NOT NULL DEFAULT 0 CHECK (is_leader IN (0,1)),
  leader_code      VARCHAR(80) UNIQUE,
  leader_since     TEXT,
  registration_method VARCHAR(12) NOT NULL CHECK (registration_method IN ('manual','invitation')),
  registered_by_user_id INT REFERENCES users(id),
  invite_link_id   INT,
  status           VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','inactive','rejected')),
  path             TEXT COLLATE "C" NOT NULL,
  depth            INT NOT NULL,
  child_count      INT NOT NULL DEFAULT 0,
  descendant_count INT NOT NULL DEFAULT 0,
  consent_at       TEXT,
  registration_ip  VARCHAR(64),
  created_at       TEXT NOT NULL DEFAULT ${TS},
  updated_at       TEXT NOT NULL DEFAULT ${TS},
  CHECK (inviter_id IS NULL OR inviter_id <> id),
  CHECK (leader_id IS NULL OR leader_id <> id),
  CHECK (inviter_id IS NOT NULL OR is_leader = 1 OR status = 'rejected')
);
CREATE INDEX IF NOT EXISTS ix_people_head     ON people (head_id, status);
CREATE INDEX IF NOT EXISTS ix_people_inviter  ON people (inviter_id, status);
CREATE INDEX IF NOT EXISTS ix_people_leader   ON people (leader_id);
CREATE INDEX IF NOT EXISTS ix_people_path     ON people (path, status);
CREATE INDEX IF NOT EXISTS ix_people_created  ON people (created_at);
CREATE INDEX IF NOT EXISTS ix_people_name     ON people (name_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS ix_people_isleader ON people (head_id, is_leader);
CREATE INDEX IF NOT EXISTS ix_people_link     ON people (invite_link_id);
CREATE INDEX IF NOT EXISTS ix_people_phone_raw ON people (phone);
-- Un teléfono / documento no puede repetirse entre registros vigentes (en ninguna cabeza).
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_phone ON people (phone) WHERE status <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_doc   ON people (document_id) WHERE document_id IS NOT NULL AND status <> 'rejected';

CREATE TABLE IF NOT EXISTS invite_links (
  id            SERIAL PRIMARY KEY,
  token         VARCHAR(80) NOT NULL UNIQUE,
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('leader','person')),
  owner_person_id INT NOT NULL REFERENCES people(id),
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  max_uses      INT,
  expires_at    TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT ${TS},
  disabled_at   TEXT,
  disabled_by   INT REFERENCES users(id),
  disabled_reason VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_links_owner ON invite_links (owner_person_id);

CREATE TABLE IF NOT EXISTS user_head_scopes (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  head_id INT NOT NULL REFERENCES heads(id),
  PRIMARY KEY (user_id, head_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  CHAR(64) PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT ${TS},
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);

-- Historial de cambios relevantes por persona (trazabilidad funcional).
CREATE TABLE IF NOT EXISTS person_history (
  id          SERIAL PRIMARY KEY,
  person_id   INT NOT NULL REFERENCES people(id),
  change_type VARCHAR(40) NOT NULL,
  details     TEXT NOT NULL DEFAULT '{}',
  reason      VARCHAR(300),
  changed_by  INT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT ${TS}
);
CREATE INDEX IF NOT EXISTS ix_history_person ON person_history (person_id, id);

-- Auditoría técnica de todas las acciones sensibles.
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id),
  action     VARCHAR(60) NOT NULL,
  entity     VARCHAR(30) NOT NULL,
  entity_id  INT,
  details    TEXT NOT NULL DEFAULT '{}',
  ip         VARCHAR(64),
  created_at TEXT NOT NULL DEFAULT ${TS}
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS ix_audit_action  ON audit_log (action text_pattern_ops);

DO $$ BEGIN
  ALTER TABLE heads ADD CONSTRAINT fk_heads_user FOREIGN KEY (created_by) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT fk_users_person FOREIGN KEY (person_id) REFERENCES people(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE people ADD CONSTRAINT fk_people_link FOREIGN KEY (invite_link_id) REFERENCES invite_links(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Integridad a nivel de base de datos (segunda línea de defensa tras los servicios).
CREATE OR REPLACE FUNCTION trg_people_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.inviter_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.inviter_id IS DISTINCT FROM OLD.inviter_id) THEN
    IF (SELECT head_id FROM people WHERE id = NEW.inviter_id) IS DISTINCT FROM NEW.head_id THEN
      RAISE EXCEPTION 'INVITER_OTHER_HEAD';
    END IF;
    IF TG_OP = 'UPDATE' AND starts_with((SELECT path FROM people WHERE id = NEW.inviter_id), OLD.path) THEN
      RAISE EXCEPTION 'CYCLE';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.leader_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM people WHERE id = NEW.leader_id AND is_leader = 1 AND head_id = NEW.head_id) THEN
    RAISE EXCEPTION 'LEADER_INVALID';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_people_consistency ON people;
CREATE TRIGGER trg_people_consistency BEFORE INSERT OR UPDATE OF inviter_id ON people
  FOR EACH ROW EXECUTE FUNCTION trg_people_consistency();

CREATE TABLE IF NOT EXISTS schema_meta (version INT NOT NULL);
`;

// v2: catálogo geográfico (Localidad → Comuna/Corregimiento → Barrio/Vereda) y nuevos campos de persona.
const MIGRATION_2 = `
CREATE TABLE IF NOT EXISTS geo_areas (
  id         SERIAL PRIMARY KEY,
  level      VARCHAR(10) NOT NULL CHECK (level IN ('localidad','comuna','barrio')),
  kind       VARCHAR(15) NOT NULL CHECK (kind IN ('localidad','comuna','corregimiento','barrio','vereda')),
  code       VARCHAR(40) UNIQUE,
  name       VARCHAR(120) NOT NULL,
  name_key   VARCHAR(120) NOT NULL,
  alias      VARCHAR(120) NOT NULL DEFAULT '',
  parent_id  INT REFERENCES geo_areas(id),
  source     VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
  active     SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT ${TS},
  updated_at TEXT NOT NULL DEFAULT ${TS},
  CHECK ((level = 'localidad') = (parent_id IS NULL)),
  CHECK ((level = 'localidad' AND kind = 'localidad') OR (level = 'comuna' AND kind IN ('comuna','corregimiento'))
      OR (level = 'barrio' AND kind IN ('barrio','vereda')))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_geo_name ON geo_areas (level, COALESCE(parent_id, 0), name_key);
CREATE INDEX IF NOT EXISTS ix_geo_parent ON geo_areas (parent_id, active);

ALTER TABLE people ADD COLUMN IF NOT EXISTS address VARCHAR(200);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_localidad_id INT REFERENCES geo_areas(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_comuna_id INT REFERENCES geo_areas(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_barrio_id INT REFERENCES geo_areas(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_localidad_text VARCHAR(120);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_comuna_text VARCHAR(120);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_barrio_text VARCHAR(120);
ALTER TABLE people ADD COLUMN IF NOT EXISTS geo_status VARCHAR(10) NOT NULL DEFAULT 'none';
DO $$ BEGIN
  ALTER TABLE people ADD CONSTRAINT ck_people_geo_status CHECK (geo_status IN ('none','verified','pending'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_people_geo_loc ON people (geo_localidad_id);
CREATE INDEX IF NOT EXISTS ix_people_geo_com ON people (geo_comuna_id);
CREATE INDEX IF NOT EXISTS ix_people_geo_bar ON people (geo_barrio_id);
CREATE INDEX IF NOT EXISTS ix_people_geo_status ON people (geo_status) WHERE geo_status = 'pending';
`;

// v3: nombres y apellidos por separado y respuesta a «¿Contamos contigo en este camino?».
const MIGRATION_3 = `
ALTER TABLE people ADD COLUMN IF NOT EXISTS first_names VARCHAR(80);
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_names VARCHAR(80);
ALTER TABLE people ADD COLUMN IF NOT EXISTS supports VARCHAR(3);
DO $$ BEGIN
  ALTER TABLE people ADD CONSTRAINT ck_people_supports CHECK (supports IS NULL OR supports IN ('yes','no'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

// v4: tipos de registro (cabeza / líder / persona) con color, enlaces de registro tipados y panel privado del líder.
const MIGRATION_4 = `
CREATE TABLE IF NOT EXISTS reg_types (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  name_key   VARCHAR(60) NOT NULL UNIQUE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('head','leader','person')),
  color      CHAR(7) NOT NULL,
  builtin    SMALLINT NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  active     SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT ${TS},
  updated_at TEXT NOT NULL DEFAULT ${TS}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reg_types_builtin ON reg_types (role) WHERE builtin = 1;
INSERT INTO reg_types (name, name_key, role, color, builtin) VALUES
  ('Cabeza', 'cabeza', 'head', '#7c3aed', 1),
  ('Líder', 'lider', 'leader', '#d97706', 1),
  ('Persona', 'persona', 'person', '#2563eb', 1)
ON CONFLICT DO NOTHING;

ALTER TABLE invite_links ALTER COLUMN owner_person_id DROP NOT NULL;
ALTER TABLE invite_links DROP CONSTRAINT IF EXISTS invite_links_kind_check;
DO $$ BEGIN
  ALTER TABLE invite_links ADD CONSTRAINT ck_links_kind CHECK (kind IN ('leader','person','register'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS reg_type_id INT REFERENCES reg_types(id);
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS head_id INT REFERENCES heads(id);
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS label VARCHAR(120);
DO $$ BEGIN
  ALTER TABLE invite_links ADD CONSTRAINT ck_links_owner CHECK (kind = 'register' OR owner_person_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_links_head ON invite_links (head_id) WHERE head_id IS NOT NULL;

ALTER TABLE people ADD COLUMN IF NOT EXISTS reg_type_id INT REFERENCES reg_types(id);
ALTER TABLE people ADD COLUMN IF NOT EXISTS panel_token_hash CHAR(64);
ALTER TABLE people ADD COLUMN IF NOT EXISTS panel_created_at TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS panel_viewed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_panel ON people (panel_token_hash) WHERE panel_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_people_reg_type ON people (reg_type_id);
UPDATE people SET reg_type_id = (SELECT id FROM reg_types WHERE builtin = 1 AND role = CASE WHEN people.is_leader = 1 THEN 'leader' ELSE 'person' END)
 WHERE reg_type_id IS NULL;
`;

// v5: «¿Es voto seguro?», la valoración de quien registra (distinta de la respuesta propia «¿Contamos contigo?»).
const MIGRATION_5 = `
ALTER TABLE people ADD COLUMN IF NOT EXISTS secure_vote VARCHAR(3);
DO $$ BEGIN
  ALTER TABLE people ADD CONSTRAINT ck_people_secure_vote CHECK (secure_vote IS NULL OR secure_vote IN ('yes','no'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

// v6: enlaces generales por tipo (uno por tipo, cabeza y dueño; sin nombre ni límites), listos para compartir.
const MIGRATION_6 = `
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS is_general SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_links_general ON invite_links (reg_type_id, head_id, owner_person_id) WHERE is_general = 1 AND status = 'active';
`;

// v7: enlaces de un solo uso para registrar cabezas y líderes. Los enlaces generales (sin límite) de esos tipos
// se desactivan: cualquiera que los recibiera reenviados podría registrarse.
const MIGRATION_7 = `
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS one_time SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS used_at TEXT;
CREATE INDEX IF NOT EXISTS ix_links_one_time ON invite_links (reg_type_id, head_id) WHERE one_time = 1;
UPDATE invite_links k SET status = 'disabled', disabled_at = ${TS}, disabled_reason = 'auto:reemplazado por enlaces de un solo uso'
 WHERE k.is_general = 1 AND k.status = 'active'
   AND (SELECT role FROM reg_types t WHERE t.id = k.reg_type_id) IN ('head','leader');
`;

// v8: la cabeza es una persona. Es el l\u00edder ra\u00edz de su estructura (is_head) y de ella cuelgan sus l\u00edderes y
// personas. Las cabezas registradas antes con un enlace de tipo \u00abcabeza\u00bb quedaban como un l\u00edder m\u00e1s: se marcan
// como cabeza y los l\u00edderes que colgaban sueltos de su estructura pasan a colgar de ella (ver adoptRootLeaders).
const MIGRATION_8 = `
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_head SMALLINT NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE people ADD CONSTRAINT ck_people_is_head
    CHECK (is_head IN (0,1) AND (is_head = 0 OR (is_leader = 1 AND inviter_id IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_head_person ON people (head_id) WHERE is_head = 1 AND status <> 'rejected';
UPDATE people p SET is_head = 1 WHERE p.id IN (
  SELECT DISTINCT ON (x.head_id) x.id FROM people x JOIN reg_types t ON t.id = x.reg_type_id
   WHERE t.role = 'head' AND x.is_leader = 1 AND x.inviter_id IS NULL AND x.status <> 'rejected'
   ORDER BY x.head_id, x.id);
-- Colores de marca para los tipos base (sólo si conservan los colores iniciales: no pisa los que se cambiaron).
UPDATE reg_types SET color = '#e0a422' WHERE builtin = 1 AND role = 'head' AND color = '#7c3aed';
UPDATE reg_types SET color = '#2f9be0' WHERE builtin = 1 AND role = 'leader' AND color = '#d97706';
UPDATE reg_types SET color = '#1d4f91' WHERE builtin = 1 AND role = 'person' AND color = '#2563eb';
`;

// v9: volver al panel con el enlace de registro ya usado (c\u00e9dula + celular), y los intentos fallidos (PIN del panel y
// recuperaci\u00f3n) guardados en la base de datos: el bloqueo vale igual con varias instancias del servidor (Vercel).
const MIGRATION_9 = `
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS recover_fails INT NOT NULL DEFAULT 0;
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS recover_locked_until TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS panel_fails INT NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN IF NOT EXISTS panel_locked_until TEXT;
`;

/**
 * Cuelga de la cabeza `head` (persona ra\u00edz) los dem\u00e1s l\u00edderes ra\u00edz de su estructura, con sus ramas completas.
 * `exec(sql, params)` ejecuta con par\u00e1metros $1\u2026; sirve tanto en la migraci\u00f3n como dentro de una transacci\u00f3n.
 * Devuelve los ids de los l\u00edderes adoptados.
 */
export async function adoptRootLeaders(exec, head, { userId = null, reason } = {}) {
  const roots = (await exec(`SELECT id, path, descendant_count, leader_id, leader_mode FROM people
      WHERE head_id = $1 AND inviter_id IS NULL AND id <> $2 AND status <> 'rejected' ORDER BY id`, [head.head_id, head.id])).rows;
  for (const r of roots) {
    // /R/\u2026 -> /C/R/\u2026 (la cabeza es ra\u00edz: su ruta es /C/).
    await exec(`UPDATE people SET path = CONCAT($1::text, substr(path, 2)), depth = depth + 1 WHERE path >= $2 AND path < $3`,
      [head.path, r.path, `${r.path}~`]);
    await exec('UPDATE people SET inviter_id = $1 WHERE id = $2', [head.id, r.id]);
    if (r.leader_mode === 'auto' && r.leader_id == null) await exec('UPDATE people SET leader_id = $1 WHERE id = $2', [head.id, r.id]);
    await exec('UPDATE people SET child_count = child_count + 1, descendant_count = descendant_count + $1 WHERE id = $2',
      [1 + r.descendant_count, head.id]);
    await exec(`INSERT INTO person_history (person_id, change_type, details, reason, changed_by) VALUES ($1, 'moved', $2, $3, $4)`,
      [r.id, JSON.stringify({ from_head_id: head.head_id, to_head_id: head.head_id, from_inviter_id: null, to_inviter_id: head.id,
        branch_size: 1 + r.descendant_count, adopted_by_head: true }), reason, userId]);
  }
  return roots.map((r) => r.id);
}

async function adoptAllRootLeaders(c) {
  const exec = (sql, params) => c.query(sql, params);
  const heads = (await c.query(`SELECT id, head_id, path FROM people WHERE is_head = 1 AND status <> 'rejected'`)).rows;
  for (const h of heads) await adoptRootLeaders(exec, h, { reason: 'Reorganizaci\u00f3n: los l\u00edderes de una estructura cuelgan de su cabeza' });
}

const nameKey = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Carga inicial del catálogo de Santa Marta (sólo si el catálogo está vacío). */
async function seedGeo(c) {
  const { rows } = await c.query('SELECT COUNT(*) AS n FROM geo_areas');
  if (rows[0].n > 0) return;
  const data = SANTA_MARTA;
  const ins = 'INSERT INTO geo_areas (level, kind, code, name, name_key, alias, parent_id, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id';
  for (const l of data.localidades) {
    const lid = (await c.query(ins, ['localidad', 'localidad', l.codigo, l.nombre, nameKey(l.nombre), l.alias, null, l.fuente])).rows[0].id;
    for (const u of l.unidades) {
      const uid = (await c.query(ins, ['comuna', u.tipo, u.codigo, u.nombre, nameKey(u.nombre), u.alias, lid, u.fuente])).rows[0].id;
      for (const [b, src] of u.barrios) {
        await c.query(ins, ['barrio', u.tipo === 'corregimiento' ? 'vereda' : 'barrio', null, b, nameKey(b), '', uid, src]);
      }
    }
  }
}

const MIGRATIONS = [
  { version: 1, sql: SCHEMA },
  { version: 2, sql: MIGRATION_2, after: seedGeo },
  { version: 3, sql: MIGRATION_3 },
  { version: 4, sql: MIGRATION_4 },
  { version: 5, sql: MIGRATION_5 },
  { version: 6, sql: MIGRATION_6 },
  { version: 7, sql: MIGRATION_7 },
  { version: 8, sql: MIGRATION_8, after: adoptAllRootLeaders },
  { version: 9, sql: MIGRATION_9 },
];

let pool = null;
let opening = null;
const txStore = new AsyncLocalStorage();

function resolveUrl(url) {
  return url || process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgres://arbol:arbolpw@localhost:5432/arbol';
}

function sslFor(u) {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(u)) return { rejectUnauthorized: false };
  // Local y red privada de Railway (*.railway.internal, ya cifrada): sin TLS. Resto: TLS.
  return /@(localhost|127\.0\.0\.1|[^/@]+\.railway\.internal)[:/]/.test(u) ? false : { rejectUnauthorized: false };
}

/** Crea el pool y aplica el esquema si hace falta. */
export async function openDb(url) {
  if (pool) await closeDb();
  const u = resolveUrl(url);
  pool = new pg.Pool({
    connectionString: u.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
    ssl: sslFor(u),
    max: Number(process.env.DB_POOL_SIZE) || (process.env.VERCEL ? 5 : 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (e) => console.error('[db] error en conexión inactiva', e.message));
  await migrate();
  return pool;
}

async function migrate() {
  const current = async (c) => {
    const { rows } = await c.query("SELECT to_regclass('schema_meta') IS NOT NULL AS ok");
    if (!rows[0].ok) return 0;
    return (await c.query('SELECT MAX(version) AS v FROM schema_meta')).rows[0].v ?? 0;
  };
  if ((await current(pool)) >= MIGRATIONS[MIGRATIONS.length - 1].version) return;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(724001)'); // una sola instancia migra a la vez
    const v = await current(c);
    for (const m of MIGRATIONS) {
      if (m.version <= v) continue;
      await c.query(m.sql);
      if (m.after) await m.after(c);
      await c.query('INSERT INTO schema_meta (version) VALUES ($1)', [m.version]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Garantiza una única apertura por proceso (útil en funciones serverless). */
export function ensureDb() {
  if (pool) return Promise.resolve(pool);
  if (!opening) opening = openDb().catch((e) => { opening = null; throw e; });
  return opening;
}

export async function closeDb() {
  if (pool) { const p = pool; pool = null; opening = null; await p.end(); }
}

// Las consultas se escriben con "?"; se traducen a $1, $2… (ignorando literales entre comillas).
const sqlCache = new Map();
function toPg(sql) {
  let out = sqlCache.get(sql);
  if (out) return out;
  let n = 0; let quote = null; out = '';
  for (const ch of sql) {
    if (quote) { out += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  if (/^\s*INSERT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING *';
  if (sqlCache.size < 2000) sqlCache.set(sql, out);
  return out;
}

const toArgs = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));

async function exec(sql, args) {
  const text = toPg(sql);
  const c = txStore.getStore();
  if (c) return c.query(text, toArgs(args));
  if (!pool) await ensureDb();
  return pool.query(text, toArgs(args));
}

/** Consulta con parámetros $1, $2… (dentro de tx() usa su conexión). Devuelve el resultado de pg ({ rows }). */
export const sqlExec = (sql, params = []) => exec(sql, params);

/**
 * Consulta parametrizada ("?"). Dentro de tx() usa automáticamente la conexión de la transacción.
 *   await q(sql).get(...args) -> primera fila | undefined
 *   await q(sql).all(...args) -> filas
 *   await q(sql).run(...args) -> { lastInsertRowid, changes }
 */
export function q(sql) {
  return {
    get: async (...args) => (await exec(sql, args)).rows[0],
    all: async (...args) => (await exec(sql, args)).rows,
    run: async (...args) => {
      const r = await exec(sql, args);
      return { lastInsertRowid: r.command === 'INSERT' ? r.rows[0]?.id ?? null : null, changes: r.rowCount };
    },
  };
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta fn dentro de una transacción. Las transacciones anidadas se integran en la
 * exterior. Reintenta ante interbloqueos.
 */
export async function tx(fn) {
  if (txStore.getStore()) return fn();
  if (!pool) await ensureDb();
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await txStore.run(c, fn);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (RETRYABLE.has(e?.code) && attempt < 4) { await sleep(30 * 2 ** attempt); continue; }
      throw e;
    } finally {
      c.release();
    }
  }
}

export const now = () => new Date().toISOString();

/** Límite superior para consultas por rango de ruta: path >= p AND path < p + '~'. */
export const pathUpper = (p) => p + '~';
export const MAX_PATH = 4000;
