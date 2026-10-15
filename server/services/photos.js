// Fotos de perfil de las personas de confianza (cabezas y líderes), guardadas en Cloudinary.
//
// El celular reduce la foto antes de enviarla; el servidor comprueba por su contenido que sea una imagen y la sube
// firmada (la clave secreta nunca sale del servidor). Cloudinary la guarda recortada en cuadrado, centrando la cara;
// en la base de datos sólo queda su dirección pública y su identificador (para borrarla al cambiarla).
// Configuración: CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> (o CLOUDINARY_CLOUD_NAME,
// CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET). Sin ella, las fotos quedan apagadas y no se ofrece subirlas.
import crypto from 'node:crypto';
import { q, now } from '../db.js';
import { AppError, badRequest } from '../util.js';
import { audit, history } from './audit.js';

const FOLDER = 'thowinsson/personas-de-confianza';
const MAX_BYTES = 4 * 1024 * 1024;
// Cuadrado de 640 px centrado en la cara (si no encuentra una, en el centro).
const INCOMING = 'c_fill,g_face,w_640,h_640';

/**
 * Tamaños en que se muestra (lado en px: el doble del círculo en pantalla), en WebP: pesa poco y se decodifica rápido
 * hasta en celulares sencillos. Se generan al subir la foto, así nadie espera a que Cloudinary los prepare la primera
 * vez que la ve. Deben coincidir con client/src/lib/photos.js.
 */
export const PHOTO_SIZES = [96, 160];
export const photoTransformation = (size) => `c_fill,w_${size},h_${size},q_auto,f_webp`;
export const photoAt = (url, size) => (url ? url.replace('/image/upload/', `/image/upload/${photoTransformation(size)}/`) : null);

function config() {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@([\w-]+)/.exec(process.env.CLOUDINARY_URL || '');
  if (m) return { key: m[1], secret: decodeURIComponent(m[2]), cloud: m[3] };
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  return cloud && key && secret ? { cloud, key, secret } : null;
}

export const photosEnabled = () => !!config();

/**
 * Firma de Cloudinary: los parámetros que se envían (sin file, cloud_name, resource_type ni api_key), en orden
 * alfabético como «nombre=valor» unidos con «&», seguidos de la clave secreta, en SHA-1.
 */
export function cloudinarySignature(params, secret) {
  const s = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(s + secret).digest('hex');
}

const serviceDown = () => new AppError(502, 'PHOTO_SERVICE', 'No se pudo guardar la foto. Revisa tu conexión e inténtalo de nuevo.');

async function cloudinary(action, params, file) {
  const c = config();
  if (!c) throw new AppError(503, 'PHOTOS_OFF', 'Las fotos todavía no están disponibles.');
  const signed = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.append(k, String(v));
  form.append('api_key', c.key);
  form.append('signature', cloudinarySignature(signed, c.secret));
  if (file) form.append('file', new Blob([file.buf], { type: file.mime }), 'foto');
  const base = process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com';
  let res;
  try {
    res = await fetch(`${base}/v1_1/${c.cloud}/image/${action}`, { method: 'POST', body: form, signal: AbortSignal.timeout(25000) });
  } catch (e) {
    console.error('[fotos]', action, e.message);
    throw serviceDown();
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) {
    console.error('[fotos]', action, res.status, d?.error?.message);
    throw serviceDown();
  }
  return { ...d, cloud: c.cloud };
}

/** «data:image/jpeg;base64,…» → bytes, comprobando por su contenido (no por su nombre) que sea JPEG, PNG o WebP. */
export function decodeImage(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(String(dataUrl ?? ''));
  if (!m) throw badRequest('PHOTO_INVALID', 'Elige una foto (JPG, PNG o WebP).');
  if (m[1].length > Math.ceil(MAX_BYTES / 3) * 4) throw badRequest('PHOTO_TOO_BIG', 'La foto pesa demasiado. Prueba con otra.');
  const buf = Buffer.from(m[1], 'base64');
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (buf.length < 100 || !(jpeg || png || webp)) throw badRequest('PHOTO_INVALID', 'Ese archivo no es una foto. Elige otra.');
  return { buf, mime: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp' };
}

/** Sube una foto (ya comprobada) a la carpeta de las personas de confianza. Devuelve { url, publicId }. */
export async function uploadPhoto(file, publicId) {
  const up = await cloudinary('upload', {
    public_id: publicId, asset_folder: FOLDER, transformation: INCOMING, eager: PHOTO_SIZES.map(photoTransformation).join('|'),
  }, file);
  const url = String(up.secure_url || '');
  if (!url.startsWith(`https://res.cloudinary.com/${up.cloud}/image/upload/`)) {
    console.error('[fotos] respuesta inesperada', url);
    throw serviceDown();
  }
  return { url, publicId: up.public_id };
}

/** Borra una foto de Cloudinary (y de su caché). Si falla, sólo queda una foto huérfana: no se interrumpe nada. */
export function destroyPhoto(publicId) {
  if (!publicId || !photosEnabled()) return Promise.resolve();
  return cloudinary('destroy', { public_id: publicId, invalidate: 'true' }).catch(() => {});
}

/**
 * Pone (o cambia) la foto de una persona de confianza y borra la anterior. `via`: 'panel' (desde su propio panel) o
 * 'coordinacion' (desde su ficha). Devuelve { photo_url }.
 */
export async function setPersonPhoto(person, dataUrl, { user = null, ip = null, via }) {
  if (!photosEnabled()) throw new AppError(503, 'PHOTOS_OFF', 'Las fotos todavía no están disponibles.');
  if (!person.is_leader) throw badRequest('NOT_TRUSTED', 'Sólo las personas de confianza (cabezas y líderes) tienen foto.');
  const file = decodeImage(dataUrl);
  const { url, publicId } = await uploadPhoto(file, `persona-${person.id}-${crypto.randomBytes(6).toString('hex')}`);
  const before = await q('SELECT photo_public_id FROM people WHERE id = ?').get(person.id);
  await q('UPDATE people SET photo_url = ?, photo_public_id = ?, photo_updated_at = ? WHERE id = ?').run(url, publicId, now(), person.id);
  await history(person.id, 'photo_set', { via }, user?.id ?? null);
  await audit(user, 'person.photo_set', 'person', person.id, { via }, ip);
  if (before?.photo_public_id && before.photo_public_id !== publicId) destroyPhoto(before.photo_public_id);
  return { photo_url: url };
}

/** Quita la foto (la coordinación, por ejemplo si no es apropiada). */
export async function removePersonPhoto(person, { user = null, ip = null } = {}) {
  const before = await q('SELECT photo_public_id FROM people WHERE id = ?').get(person.id);
  await q('UPDATE people SET photo_url = NULL, photo_public_id = NULL, photo_updated_at = ? WHERE id = ?').run(now(), person.id);
  await history(person.id, 'photo_removed', {}, user?.id ?? null);
  await audit(user, 'person.photo_removed', 'person', person.id, {}, ip);
  destroyPhoto(before?.photo_public_id);
  return { photo_url: null };
}
