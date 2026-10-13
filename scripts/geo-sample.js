import { q } from '../server/db.js';

/** Generador determinista de ubicaciones del catálogo (y algunas escritas a mano) para datos de ejemplo. */
export async function locationPicker(seed = 7) {
  const barrios = await q(`SELECT b.id AS barrio_id, c.id AS comuna_id, c.parent_id AS localidad_id FROM geo_areas b
                            JOIN geo_areas c ON c.id = b.parent_id WHERE b.level = 'barrio' AND b.active = 1 ORDER BY b.id`).all();
  const comunas = await q(`SELECT id AS comuna_id, parent_id AS localidad_id FROM geo_areas WHERE level = 'comuna' ORDER BY id`).all();
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return (i) => {
    const r = rnd();
    if (i % 41 === 7) { // barrio escrito a mano (pendiente de verificación)
      const c = comunas[Math.floor(rnd() * comunas.length)];
      return { localidad_id: c.localidad_id, comuna_id: c.comuna_id, barrio_text: ['Villa Betel', 'Urbanización Ciudad Equidad', 'Sector La Paz'][i % 3] };
    }
    if (r < 0.1) { const c = comunas[Math.floor(rnd() * comunas.length)]; return { localidad_id: c.localidad_id, comuna_id: c.comuna_id }; }
    const b = barrios[Math.floor(rnd() * barrios.length)];
    return { localidad_id: b.localidad_id, comuna_id: b.comuna_id, barrio_id: b.barrio_id };
  };
}

export const sampleAddress = (i) => `Calle ${(i % 40) + 1} # ${(i % 27) + 2}-${(i % 90) + 10}`;
