import crypto from 'node:crypto';
import { q } from './db.js';
import { hashPassword } from './auth.js';

/** Crea el administrador general inicial si no existe ningún usuario. */
export function ensureBootstrapAdmin() {
  const n = q('SELECT COUNT(*) n FROM users').get().n;
  if (n > 0) return null;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  q(`INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'super_admin')`)
    .run(username, 'Administrador general', hashPassword(password));
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`\n[bootstrap] Usuario administrador creado: ${username} / ${password}\n            Cámbielo tras el primer acceso.\n`);
  }
  return { username, password };
}
