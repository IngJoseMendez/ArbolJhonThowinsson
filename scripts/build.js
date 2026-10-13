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
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(client, 'dist'), path.join(root, 'dist'), { recursive: true });
console.log(`[build] salida lista en ${path.join(root, 'dist')} y ${path.join(client, 'dist')}`);
