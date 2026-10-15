// Datos de demostración con el ejemplo del enunciado (Cabeza Norte) y dos cabezas más.
// Uso: npm run seed   (sólo si la base de datos está vacía; FORCE=1 para añadir igualmente)
import { openDb, q, closeDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { createPerson, registerViaInvite } from '../server/services/people.js';
import { locationPicker, sampleAddress } from './geo-sample.js';

await openDb();
if ((await q('SELECT COUNT(*) n FROM people').get()).n > 0 && !process.env.FORCE) {
  console.log('La base de datos ya tiene personas; no se cargan datos de ejemplo (use FORCE=1 para forzar).');
  await closeDb();
  process.exit(0);
}

async function ensureUser(username, display, role, password, { personId = null, heads = [] } = {}) {
  let u = await q('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  if (!u) {
    const r = await q('INSERT INTO users (username, display_name, password_hash, role, person_id) VALUES (?,?,?,?,?)')
      .run(username, display, hashPassword(password), role, personId);
    u = { id: Number(r.lastInsertRowid) };
    for (const h of heads) await q('INSERT INTO user_head_scopes (user_id, head_id) VALUES (?,?)').run(u.id, h);
  }
  return await q('SELECT * FROM users WHERE id = ?').get(u.id);
}

const admin = await ensureUser('admin', 'Administrador general', 'super_admin', process.env.ADMIN_PASSWORD || 'Admin1234!');

async function head(name, color, region, description) {
  const r = await q(`INSERT INTO heads (name, slug, color, region, description, created_by) VALUES (?,?,?,?,?,?)`)
    .run(name, name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'), color, region, description, admin.id);
  return Number(r.lastInsertRowid);
}

let phoneSeq = 3001000000;
let docSeq = 1082900000;
let seq = 0;
const pickLocation = await locationPicker();
const fields = () => { seq++; return { document_id: String(docSeq++), address: sampleAddress(seq), location: pickLocation(seq) }; };
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const manual = async (headId, name, inviterId, opts = {}) => (await createPerson({
  data: { full_name: name, phone: String(phoneSeq++), ...fields() },
  headId, inviterId, isLeader: !!opts.leader, method: 'manual', user: admin, status: 'active', createdAt: opts.at,
})).id;
const viaLink = async (ownerId, name, at) => {
  const link = await q(`SELECT token FROM invite_links WHERE owner_person_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`).get(ownerId);
  const { person } = await registerViaInvite(link.token, { full_name: name, phone: String(phoneSeq++), ...fields(), consent: true, supports: seq % 4 ? 'yes' : 'no' }, '127.0.0.1');
  if (at) await q('UPDATE people SET created_at = ? WHERE id = ?').run(at, person.id);
  return person.id;
};

// --- Cabeza Norte (ejemplo literal del enunciado) ---
const norte = await head('Cabeza Norte', '#2a78d6', 'Zona Norte', 'Estructura de ejemplo del enunciado.');
const juan = await manual(norte, 'Juan Pérez', null, { leader: true, at: day(80) });
const maria = await viaLink(juan, 'María Gómez', day(70));
const pedro = await viaLink(maria, 'Pedro Ramírez', day(60));
await viaLink(pedro, 'Carlos Rodríguez', day(40));
await viaLink(pedro, 'Andrea López', day(35));
await viaLink(maria, 'Laura Martínez', day(55));
const jose = await manual(norte, 'José Hernández', juan, { leader: true, at: day(65) });
const ricardo = await viaLink(jose, 'Ricardo Torres', day(45));
await viaLink(ricardo, 'Sofía Castro', day(20));
const ana = await manual(norte, 'Ana Morales', null, { leader: true, at: day(75) });
await viaLink(ana, 'Camilo Vargas', day(30));

// --- Otras cabezas con algo de volumen ---
const first = ['Luis', 'Diana', 'Andrés', 'Paula', 'Jorge', 'Carolina', 'Felipe', 'Valentina', 'Santiago', 'Natalia', 'Mateo', 'Isabela', 'Daniel', 'Gabriela', 'Julián', 'Mariana'];
const last = ['García', 'Rojas', 'Díaz', 'Moreno', 'Jiménez', 'Ruiz', 'Álvarez', 'Romero', 'Suárez', 'Ortiz', 'Silva', 'Mendoza'];
let k = 0;
const nm = () => `${first[k % first.length]} ${last[Math.floor(k++ / first.length) % last.length]} ${last[(k * 7) % last.length]}`;

for (const [name, color, region] of [['Cabeza Sur', '#eb6834', 'Zona Sur'], ['Cabeza Centro', '#1baf7a', 'Zona Centro']]) {
  const h = await head(name, color, region, `Estructura territorial ${region}.`);
  for (let L = 0; L < 3; L++) {
    const leader = await manual(h, nm(), null, { leader: true, at: day(88 - L * 5) });
    const level1 = [];
    for (let i = 0; i < 4; i++) level1.push(await viaLink(leader, nm(), day(80 - L * 5 - i * 3)));
    for (const p1 of level1) {
      for (let j = 0; j < 2; j++) {
        const p2 = await viaLink(p1, nm(), day(60 - j * 9 - L * 3));
        if ((p2 + j) % 3 === 0) await viaLink(p2, nm(), day(25 - j * 4));
      }
    }
  }
}

// Cuentas de ejemplo para probar permisos.
const sur = (await q(`SELECT id FROM heads WHERE name = 'Cabeza Sur'`).get()).id;
await ensureUser('admin.norte', 'Admin Cabeza Norte', 'head_admin', 'Norte1234!', { heads: [norte] });
await ensureUser('admin.sur', 'Admin Cabeza Sur', 'head_admin', 'Sur12345!', { heads: [sur] });
await ensureUser('juan', 'Juan Pérez', 'leader', 'Juan1234!', { personId: juan });
await ensureUser('maria', 'María Gómez', 'member', 'Maria1234!', { personId: maria });

console.log('Datos de ejemplo cargados.');
console.log('Usuarios: admin/Admin1234!  admin.norte/Norte1234!  admin.sur/Sur12345!  juan/Juan1234! (líder)  maria/Maria1234! (persona)');
await closeDb();
