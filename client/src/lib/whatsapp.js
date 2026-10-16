import { CAMPAIGN } from '../brand/Brand.jsx';
import { isIOSStandalone, isPhoneNow } from './device.js';

// Enlaces a WhatsApp y mensajes para las personas invitadas (se les habla de tú). De cara a ellas no hay «cabezas»,
// «líderes» ni «convenios»: quien recibe una invitación personal es una persona de confianza.

/** Celular colombiano con indicativo: los últimos 10 dígitos con 57 adelante (o vacío si no es un celular). */
export function normalizePhone57(p) {
  const d = String(p ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `57${d}` : '';
}

/**
 * Enlace que abre WhatsApp con el mensaje escrito (y el chat de esa persona si se da su celular).
 * En la app instalada del iPhone, wa.me se queda en la página de WhatsApp dentro de Safari: allí se abre la app directo.
 */
export function waUrl(text, phone) {
  const ph = phone ? normalizePhone57(phone) : '';
  if (isIOSStandalone()) return `whatsapp://send?text=${encodeURIComponent(text)}${ph ? `&phone=${ph}` : ''}`;
  return `https://wa.me/${ph}?text=${encodeURIComponent(text)}`;
}

/** En el celular WhatsApp se abre en la misma ventana (la app queda donde estaba); en el computador, en otra pestaña. */
export const extLinkProps = () => (isPhoneNow() ? {} : { target: '_blank', rel: 'noopener noreferrer' });

const hello = (name) => `Hola${name ? `, ${String(name).trim().split(/\s+/)[0]}` : ''}.`;

/**
 * Invitación personal de un solo uso para ser persona de confianza: de John (las cabezas, que arman su propio
 * equipo, y quienes quedan directo con él: direct) o de quien encabeza un equipo (sus líderes).
 */
export function inviteText({ role, name, cabeza, direct, url }) {
  const what = role === 'head'
    ? `${CAMPAIGN} quiere contar contigo como una de sus personas de confianza: con tu registro nace tu propio equipo para sumar a tu gente.`
    : direct ? `${CAMPAIGN} quiere contar contigo como una de sus personas de confianza.`
    : cabeza
      ? `${cabeza} quiere contar contigo como una de sus personas de confianza en el equipo de ${CAMPAIGN}.`
      : `Te invitamos a ser persona de confianza en el equipo de ${CAMPAIGN}.`;
  return `${hello(name)} ${what} Este enlace es personal y sirve para una sola persona, no lo reenvíes: ${url}`;
}

/** Recordatorio de una invitación que aún no se ha usado (el mismo enlace). */
export function reminderText({ role, name, cabeza, direct, url }) {
  const john = role === 'head' || direct;
  const from = john ? CAMPAIGN : cabeza;
  const what = from ? `la invitación de ${from} para ser una de sus personas de confianza` : 'tu invitación para ser persona de confianza';
  return `${hello(name)} Te recuerdo ${what}${john ? '' : ` en el equipo de ${CAMPAIGN}`}. Es solo para ti: ${url}`;
}

/** El panel privado de un líder o una cabeza. */
export function panelText({ name, url }) {
  return `${hello(name)} Este es tu panel del equipo de ${CAMPAIGN}: ahí ves cómo crece tu equipo. Es privado, no lo reenvíes. `
    + `Para entrar te pedirá los últimos 4 dígitos de tu cédula: ${url}`;
}

/** El enlace propio de una persona o un líder, enviado a esa misma persona. */
export function ownLinkText({ name, url }) {
  return `${hello(name)} Este es tu enlace para invitar personas al equipo de ${CAMPAIGN}: ${url}`;
}
