import { LETTERS, MARK_A, MARK_B, TH, LOGO_W, LOGO_H } from './logoPaths.js';

/**
 * Logotipo de Thowinsson.
 * tone: 'sky' (letras celestes, para fondos azules), 'navy' (para fondos claros) o 'white'.
 */
export function Logo({ tone = 'sky', className = '', title = 'Thowinsson', ...rest }) {
  return (
    <svg className={`logo logo-${tone} ${className}`} viewBox={`0 0 ${LOGO_W} ${LOGO_H}`} role="img" aria-label={title} {...rest}>
      <path className="logo-ink" fillRule="evenodd" d={LETTERS} />
      <path className="logo-a" d={MARK_A} />
      <path className="logo-b" d={MARK_B} />
    </svg>
  );
}

/**
 * Doble ángulo de la marca («subimos juntos»). Por defecto toma el color del texto;
 * duo: con los colores del logotipo (blanco y celeste).
 */
export function Mark({ size = 16, duo = false, className = '', title, ...rest }) {
  return (
    <svg className={`mark ${duo ? 'mark-duo' : ''} ${className}`} width={size} height={size} viewBox="0 0 134 136"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} {...rest}>
      <path className="mark-a" d="M44 0H134V90H110V24H44Z" />
      <path className="mark-b" d="M0 46H90V136H66V70H0Z" />
    </svg>
  );
}

/** Monograma «Th» con el doble ángulo, como el ícono de la app. */
export function Monogram({ className = '', title = 'Thowinsson', ...rest }) {
  return (
    <svg className={`monogram ${className}`} viewBox="0 0 339 300" role="img" aria-label={title} {...rest}>
      <path className="logo-ink" d={TH} transform="translate(-2,-5)" />
      <g transform="translate(203,0)">
        <path className="logo-a" d="M44 0H134V90H110V24H44Z" />
        <path className="logo-b" d="M0 46H90V136H66V70H0Z" />
      </g>
    </svg>
  );
}

const PHOTOS = {
  face: { w: 320, h: 320, src: '/brand/john-face', widths: [160, 320] },
  hero: { w: 720, h: 900, src: '/brand/john-hero' },
};

/**
 * Foto de John Thowinsson (rostro para avatares o retrato para las cabeceras).
 * sizes: ancho con que se muestra el rostro; el navegador elige la versión más liviana que se vea nítida.
 */
export function JohnPhoto({ variant = 'face', className = '', alt = 'John Thowinsson', eager, sizes = '104px', ...rest }) {
  const p = PHOTOS[variant];
  const set = (ext) => (p.widths ? p.widths.map((w) => `${p.src}${w === p.w ? '' : `-${w}`}.${ext} ${w}w`).join(', ') : `${p.src}.${ext}`);
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={set('webp')} sizes={p.widths ? sizes : undefined} />
      <img src={`${p.src}.jpg`} srcSet={p.widths ? set('jpg') : undefined} sizes={p.widths ? sizes : undefined} alt={alt} width={p.w} height={p.h}
        loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} {...rest} />
    </picture>
  );
}

export const CAMPAIGN = 'John Thowinsson';
export const SLOGAN = 'En tus manos tienes el poder del cambio';
