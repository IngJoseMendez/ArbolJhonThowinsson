// Conexión SQLite y esquema de datos.
//
// Relaciones clave de `people` (no deben confundirse):
//   head_id    -> PERTENENCIA: la cabeza a la que pertenece la persona (exactamente una).
//   leader_id  -> RESPONSABILIDAD: el líder oficial responsable (puede ser NULL).
//   inviter_id -> INVITACIÓN DIRECTA: quién invitó realmente a la persona.
//                 NULL sólo para líderes raíz colgados directamente de la cabeza.
//
// El árbol de invitaciones se materializa en `path` ("/1/5/9/") para consultar
// ramas completas con un rango indexado, sin recursión.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS heads (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  region        TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '#2a78d6',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
  person_invites_enabled INTEGER NOT NULL DEFAULT 1 CHECK (person_invites_enabled IN (0,1)),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS people (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,              -- identificador único de la persona (PER-...)
  full_name        TEXT NOT NULL,
  name_key         TEXT NOT NULL,                     -- nombre normalizado para búsqueda
  phone            TEXT NOT NULL,                     -- normalizado (sólo dígitos)
  email            TEXT,
  document_id      TEXT,                              -- documento de identidad (opcional, normalizado)
  city             TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  head_id          INTEGER NOT NULL REFERENCES heads(id),
  inviter_id       INTEGER REFERENCES people(id),
  leader_id        INTEGER REFERENCES people(id),
  leader_mode      TEXT NOT NULL DEFAULT 'auto' CHECK (leader_mode IN ('auto','manual')),
  is_leader        INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0,1)),
  leader_code      TEXT UNIQUE,                       -- LID-JUAN-PEREZ (sólo líderes)
  leader_since     TEXT,
  registration_method TEXT NOT NULL CHECK (registration_method IN ('manual','invitation')),
  registered_by_user_id INTEGER REFERENCES users(id),
  invite_link_id   INTEGER REFERENCES invite_links(id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','inactive','rejected')),
  path             TEXT NOT NULL,
  depth            INTEGER NOT NULL,
  consent_at       TEXT,
  registration_ip  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (inviter_id IS NULL OR inviter_id <> id),
  CHECK (leader_id IS NULL OR leader_id <> id),
  CHECK (inviter_id IS NOT NULL OR is_leader = 1 OR status = 'rejected')
);
CREATE INDEX IF NOT EXISTS ix_people_head     ON people(head_id, status);
CREATE INDEX IF NOT EXISTS ix_people_inviter  ON people(inviter_id, status);
CREATE INDEX IF NOT EXISTS ix_people_leader   ON people(leader_id);
CREATE INDEX IF NOT EXISTS ix_people_path     ON people(path, status);
CREATE INDEX IF NOT EXISTS ix_people_created  ON people(created_at);
CREATE INDEX IF NOT EXISTS ix_people_name     ON people(name_key);
CREATE INDEX IF NOT EXISTS ix_people_isleader ON people(head_id, is_leader);
-- Un teléfono / documento no puede repetirse entre registros vigentes (en ninguna cabeza).
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_phone ON people(phone) WHERE status <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS ux_people_doc   ON people(document_id) WHERE document_id IS NOT NULL AND status <> 'rejected';

CREATE TABLE IF NOT EXISTS invite_links (
  id            INTEGER PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,                -- lo que va en la URL /registro/<token>
  kind          TEXT NOT NULL CHECK (kind IN ('leader','person')),
  owner_person_id INTEGER NOT NULL REFERENCES people(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  max_uses      INTEGER,
  expires_at    TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  disabled_at   TEXT,
  disabled_by   INTEGER REFERENCES users(id),
  disabled_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_links_owner ON invite_links(owner_person_id);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','head_admin','leader','member')),
  person_id     INTEGER UNIQUE REFERENCES people(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_head_scopes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  head_id INTEGER NOT NULL REFERENCES heads(id),
  PRIMARY KEY (user_id, head_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL
);

-- Historial de cambios relevantes por persona (trazabilidad funcional).
CREATE TABLE IF NOT EXISTS person_history (
  id          INTEGER PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES people(id),
  change_type TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '{}',
  reason      TEXT,
  changed_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_history_person ON person_history(person_id, id);

-- Auditoría técnica de todas las acciones sensibles.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  details    TEXT NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);

-- Integridad a nivel de base de datos (segunda línea de defensa tras los servicios).
CREATE TRIGGER IF NOT EXISTS trg_people_insert_consistency
BEFORE INSERT ON people
BEGIN
  SELECT RAISE(ABORT, 'INVITER_OTHER_HEAD')
   WHERE NEW.inviter_id IS NOT NULL
     AND (SELECT head_id FROM people WHERE id = NEW.inviter_id) IS NOT NEW.head_id;
  SELECT RAISE(ABORT, 'LEADER_INVALID')
   WHERE NEW.leader_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.leader_id AND is_leader = 1 AND head_id = NEW.head_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_people_inviter_update
BEFORE UPDATE OF inviter_id ON people
WHEN NEW.inviter_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'INVITER_OTHER_HEAD')
   WHERE (SELECT head_id FROM people WHERE id = NEW.inviter_id) IS NOT NEW.head_id;
  SELECT RAISE(ABORT, 'CYCLE')
   WHERE (SELECT path FROM people WHERE id = NEW.inviter_id) LIKE (OLD.path || '%');
END;
`;

let db;

export function openDb(file = process.env.DB_FILE || path.resolve('data', 'arbol.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) openDb();
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = undefined; }
}

const stmtCache = new Map();
/** Sentencia preparada reutilizable. */
export function q(sql) {
  const d = getDb();
  let s = stmtCache.get(sql);
  if (!s || s.__db !== d) {
    s = d.prepare(sql);
    s.__db = d;
    stmtCache.set(sql, s);
  }
  return s;
}

let txDepth = 0;
/** Ejecuta fn dentro de una transacción (anidable mediante SAVEPOINT). */
export function tx(fn) {
  const d = getDb();
  const sp = `sp${txDepth}`;
  d.exec(txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    d.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    txDepth--;
    d.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export const now = () => new Date().toISOString();

/** Límite superior para consultas por rango de ruta: path >= p AND path < p + '~'. */
export const pathUpper = (p) => p + '~';
