// Compilación del cliente para cualquier configuración de Vercel:
// genera client/dist y una copia en <raíz>/dist (lo que Vercel busca como "dist").
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'client');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

console.log(`[build] commit ${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || '(local)'} · raíz ${root}`);
run('npm install --include=dev --no-audit --no-fund', client);
run('npx vite build', client);

// Vistas previas al compartir enlaces: WhatsApp y Facebook necesitan la URL absoluta de la imagen.
// En Vercel el index.html se sirve tal cual, así que se completa al compilar con el dominio de producción.
// (El servidor Express lo completa al servir con el dominio de cada petición.)
const origin = process.env.PUBLIC_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
if (origin) {
  const index = path.join(client, 'dist', 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replaceAll('__PUBLIC_ORIGIN__', origin.replace(/\/$/, '')));
  console.log(`[build] vistas previas con ${origin}`);
}
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(client, 'dist'), path.join(root, 'dist'), { recursive: true });
console.log(`[build] salida lista en ${path.join(root, 'dist')} y ${path.join(client, 'dist')}`);
