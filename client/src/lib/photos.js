// Fotos de perfil de las personas de confianza (guardadas en Cloudinary).

/**
 * La foto en un tamaño liviano para donde se muestra (`px` en pantalla, al doble para pantallas nítidas), en WebP o
 * AVIF cuando el navegador los admite. La foto ya se guardó cuadrada y centrada en la cara: aquí sólo se escala. Pocos
 * tamaños distintos: así Cloudinary reutiliza los que ya preparó.
 */
export function photoSrc(url, px = 64) {
  if (!url) return null;
  const want = px * 2;
  const size = want <= 96 ? 96 : want <= 160 ? 160 : 320;
  return url.includes('/image/upload/') ? url.replace('/image/upload/', `/image/upload/c_fill,w_${size},h_${size},f_auto,q_auto/`) : url;
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/**
 * Lee la foto elegida (cámara o galería), la deja derecha y la reduce (lado mayor de 1280 px) a JPEG: así sube rápido
 * aunque haya poca señal. Devuelve un «data:image/jpeg;base64,…».
 */
export async function readPhoto(file, max = 1280) {
  if (!file || (file.type && !file.type.startsWith('image/'))) throw new Error('Elige una foto.');
  let img;
  try {
    img = new Image();
    img.src = await readAsDataUrl(file);
    await img.decode();
  } catch {
    throw new Error('No pudimos abrir esa foto. Prueba con otra.');
  }
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** Espera a que la foto nueva esté descargada (así no parpadea al cambiarla). */
export function preloadPhoto(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(); return; }
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}
