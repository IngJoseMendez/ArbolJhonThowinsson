// Sesión del panel en este dispositivo. El PIN se recuerda sólo en esta pestaña (sessionStorage): al cerrarla se
// vuelve a pedir. Así, recargar la página nunca deja a nadie por fuera de su panel.
const key = (kind, token) => `panel-${kind}:${String(token).slice(0, 10)}`;
const get = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ } };

export const readPin = (token) => get(key('pin', token)) || '';
export const savePin = (token, pin) => set(key('pin', token), pin);

/** Últimos 4 dígitos de la cédula (el PIN del panel). */
export const pinFromCedula = (doc) => String(doc || '').replace(/\D/g, '').slice(-4);

// Invitaciones entregadas desde este dispositivo cuyo aviso aún no llegó al servidor (sin conexión, por ejemplo):
// viajan con la siguiente preparación, así la misma nunca vuelve a salir. Quedan aunque se cierre la pestaña.
const readSent = (token) => {
  try {
    const v = JSON.parse(localStorage.getItem(key('sent', token)) || '[]');
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string').slice(-20) : [];
  } catch { return []; }
};
const writeSent = (token, list) => {
  try {
    if (list.length) localStorage.setItem(key('sent', token), JSON.stringify(list.slice(-20)));
    else localStorage.removeItem(key('sent', token));
  } catch { /* sin almacenamiento */ }
};
export const unconfirmedInvites = (token) => readSent(token);
export const rememberDelivered = (token, invite) => writeSent(token, [...readSent(token).filter((t) => t !== invite), invite]);
export const confirmDelivered = (token, invites) => writeSent(token, readSent(token).filter((t) => !invites.includes(t)));

/** Panel recién estrenado en este dispositivo: se muestra una vez la invitación a guardarlo. */
export const markNewPanel = (token) => set(key('new', token), '1');
export const isNewPanel = (token) => get(key('new', token)) === '1';
export const clearNewPanel = (token) => set(key('new', token), null);

/** Deja la pantalla de bienvenida como el panel: si la persona recarga, entra directo a su panel. */
export function openPanelHere(token, cedula) {
  savePin(token, pinFromCedula(cedula));
  markNewPanel(token);
  try { window.history.replaceState(window.history.state, '', `/panel/${token}`); } catch { /* sin historial */ }
}
