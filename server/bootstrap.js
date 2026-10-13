import crypto from 'node:crypto';
import { q } from './db.js';
import { hashPassword } from './auth.js';

/** Crea el administrador general inicial si no existe ningún usuario. */
export async function ensureBootstrapAdmin() {
  const n = (await q('SELECT COUNT(*) n FROM users').get()).n;
  if (n > 0) return null;
  const username = process.env.ADMIN_USER || 'admin';
  if (process.env.VERCEL && !process.env.ADMIN_PASSWORD) {
    // En producción no se genera ni se escribe en los logs una contraseña aleatoria.
    console.warn('[bootstrap] Defina ADMIN_PASSWORD (y opcionalmente ADMIN_USER) para crear el administrador inicial.');
    return null;
  }
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  try {
    await q(`INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'super_admin')`)
      .run(username, 'Administrador general', hashPassword(password));
  } catch (e) {
    if (e.code === '23505') return null; // otra instancia lo creó a la vez
    throw e;
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`\n[bootstrap] Usuario administrador creado: ${username} / ${password}\n            Cámbielo tras el primer acceso.\n`);
  }
  return { username, password };
}
