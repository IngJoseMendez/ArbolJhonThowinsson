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

// COUNT/SUM devuelven bigint/numeric: se convierten a número de JavaScript.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const SCHEMA_VERSION = 1;
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
  const { rows } = await pool.query("SELECT to_regclass('schema_meta') IS NOT NULL AS ok");
  if (rows[0].ok) {
    const { rows: v } = await pool.query('SELECT MAX(version) AS v FROM schema_meta');
    if ((v[0]?.v ?? 0) >= SCHEMA_VERSION) return;
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(724001)'); // una sola instancia migra a la vez
    const again = await c.query("SELECT to_regclass('schema_meta') IS NOT NULL AS ok");
    const done = again.rows[0].ok
      && ((await c.query('SELECT MAX(version) AS v FROM schema_meta')).rows[0].v ?? 0) >= SCHEMA_VERSION;
    if (!done) {
      await c.query(SCHEMA);
      await c.query('INSERT INTO schema_meta (version) VALUES ($1)', [SCHEMA_VERSION]);
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
