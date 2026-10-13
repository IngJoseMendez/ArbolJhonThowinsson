import { q } from '../server/db.js';
import { createPerson } from '../server/services/people.js';
import { locationPicker, sampleAddress } from './geo-sample.js';
import { looksFake } from '../server/util.js';

/** Crea una cabeza con n personas: 10 líderes raíz, ramas de invitación de profundidad variable. */
export async function generateLarge(n, headName) {
  const admin = await q(`SELECT * FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1`).get();
  const h = await q(`INSERT INTO heads (name, slug, color, region) VALUES (?, ?, '#7c3aed', 'Pruebas de carga')`)
    .run(headName, `masiva-${Date.now()}`);
  const headId = Number(h.lastInsertRowid);
  // Celulares válidos (prefijos 310–319) sin colisiones entre ejecuciones.
  let phone = 3100000000 + Math.floor(Math.random() * 9) * 1e7 + 1000000 + Math.floor(Math.random() * 8e6);
  let doc = 1000000000 + Math.floor(Math.random() * 8e8);
  const pickLocation = await locationPicker(headId);
  const nodes = [];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const start = Date.now() - 365 * 864e5;
  for (let i = 0; i < n; i++) {
    let inviter = null;
    let leader = false;
    if (i < 10) leader = true;
    else {
      // Preferencia por nodos recientes => ramas profundas; algunos nodos acumulan muchos invitados.
      const idx = rnd() < 0.15 ? Math.floor(rnd() * Math.min(nodes.length, 50)) : nodes.length - 1 - Math.floor(rnd() * Math.min(nodes.length, 400));
      inviter = nodes[idx];
      leader = rnd() < 0.01;
    }
    while (looksFake(String(phone).slice(3))) phone++;
    while (looksFake(String(doc))) doc++;
    const p = await createPerson({
      data: {
        full_name: `Persona ${i} Prueba${leader ? ' Lider' : ''}`, phone: String(phone++), document_id: String(doc++),
        address: sampleAddress(i), location: pickLocation(i),
      },
      headId, inviterId: inviter, isLeader: leader, method: inviter && rnd() < 0.8 ? 'invitation' : 'manual',
      user: admin, status: 'active', createdAt: new Date(start + (i / n) * 365 * 864e5).toISOString(),
    });
    nodes.push(p.id);
  }
  return { headId, headName, count: n };
}
