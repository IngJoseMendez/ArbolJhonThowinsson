// Fotos de perfil de las personas de confianza (guardadas en Cloudinary).

/**
 * La foto en un tamaño liviano para donde se muestra (`px` en pantalla, al doble para pantallas nítidas), en WebP: pesa
 * poco y se decodifica rápido. La foto ya se guardó cuadrada y centrada en la cara: aquí sólo se escala. Los tamaños de
 * 96 y 160 px se generan al subirla (server/services/photos.js, misma transformación): llegan sin esperas.
 */
export function photoSrc(url, px = 64) {
  if (!url) return null;
  const want = px * 2;
  const size = want <= 96 ? 96 : want <= 160 ? 160 : 320;
  return url.includes('/image/upload/') ? url.replace('/image/upload/', `/image/upload/c_fill,w_${size},h_${size},q_auto,f_webp/`) : url;
}

/**
 * Lee la foto elegida (cámara o galería), la deja derecha y la reduce (lado mayor de 1024 px: de sobra para el cuadrado
 * de 640 que se guarda) a JPEG: así sube rápido aunque haya poca señal (unos 100 a 200 kB). Se lee directo del archivo,
 * sin pasarla a texto: más rápido y con menos memoria en celulares sencillos. Devuelve «data:image/jpeg;base64,…».
 */
export async function readPhoto(file, max = 1024) {
  if (!file || (file.type && !file.type.startsWith('image/'))) throw new Error('Elige una foto.');
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch { throw new Error('No pudimos abrir esa foto. Prueba con otra.'); }
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(src);
  }
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
