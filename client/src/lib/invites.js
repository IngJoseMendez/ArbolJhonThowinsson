import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { inviteUrl } from './format.js';
import { deviceKey, haptic } from './device.js';
import { invalidate, onClear } from './cache.js';

// Invitaciones de un solo uso para cabezas y líderes, listas antes del toque.
//
// Cada dispositivo tiene preparada una invitación por tipo y cabeza. Así el botón de WhatsApp es un enlace real: un
// toque y se abre WhatsApp con el mensaje escrito (sin ventanas en blanco ni bloqueos del navegador). Al tocarlo, la
// invitación queda marcada como enviada y, cuando el servidor ya lo registró, se prepara la siguiente: nunca vuelve
// la misma. Todos los botones del mismo tipo y cabeza comparten la misma invitación.

const scopes = new Map(); // 'tipo:cabeza' -> { typeId, headId, link, stats, loading, checking, sending, error, at, mounted }
const subs = new Set();
let tick = 0;
const emit = () => { tick++; subs.forEach((fn) => fn()); };
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const keyOf = (typeId, headId) => `${typeId}:${headId || ''}`;
function scope(typeId, headId) {
  const key = keyOf(typeId, headId);
  if (!scopes.has(key)) {
    scopes.set(key, { typeId, headId: headId || null, link: null, stats: null, loading: false, checking: false, sending: false, error: null, at: 0, mounted: 0 });
  }
  return scopes.get(key);
}

// Entregadas desde esta pestaña. `pending`: su aviso de envío aún no se confirmó; viajan con la siguiente preparación
// y el servidor las marca enviadas antes de elegir otra. `burned`: entregadas aquí o en otra pestaña; nunca se
// vuelven a ofrecer.
const pending = new Set();
const burned = new Set();
const recentBurned = () => [...burned].slice(-20);

// La última entrega: al volver de WhatsApp se confirma con un aviso que permite anularla.
let lastSent = null;
const sentSubs = new Set();
const notifySent = () => sentSubs.forEach((fn) => fn());
export const subscribeSent = (fn) => { sentSubs.add(fn); return () => sentSubs.delete(fn); };
export const getLastSent = () => lastSent;
export const clearLastSent = () => { lastSent = null; notifySent(); };

async function prepare(s, { quiet = false } = {}) {
  if (s.loading || s.checking) return;
  if (quiet) s.checking = true;
  else { s.loading = true; s.error = null; emit(); }
  const delivered = [...pending];
  let again = false;
  try {
    const l = await api.post('/links/one-time', {
      reg_type_id: s.typeId, head_id: s.headId, prepare: true, device: deviceKey(),
      ...(delivered.length ? { delivered } : {}), ...(burned.size ? { exclude: recentBurned() } : {}),
    });
    delivered.forEach((id) => pending.delete(id));
    // Si se entregó mientras llegaba la respuesta (aquí o en otra pestaña), se descarta y se pide otra.
    if (burned.has(l.id)) { s.link = null; s.at = 0; again = true; return; }
    s.link = l; s.stats = l.stats; s.at = Date.now(); s.error = null;
  } catch (e) {
    // Una comprobación sin conexión deja la invitación como estaba.
    if (!quiet) { s.link = null; s.error = e; }
  } finally {
    s.loading = false; s.checking = false; emit();
    if (again) prepare(s);
  }
}

// Las pestañas del mismo dispositivo comparten la invitación preparada: al entregarla en una, las otras la descartan
// y preparan otra. Tras anular las sin usar, todas preparan una nueva.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('thowinsson-invites') : null;
channel?.addEventListener('message', ({ data }) => {
  if (data?.sent) burned.add(data.sent);
  for (const [key, s] of scopes) {
    if (s.sending || !((data?.sent && s.link?.id === data.sent) || data?.reset === key)) continue;
    s.link = null; s.at = 0;
    if (s.mounted) prepare(s);
  }
  emit();
});

/** La invitación preparada de un tipo y cabeza quedó anulada (se anularon las sin usar): se prepara otra. */
export function forgetInvite(typeId, headId) {
  const key = keyOf(typeId, headId);
  channel?.postMessage({ reset: key });
  const s = scopes.get(key);
  if (!s) return;
  s.link = null; s.at = 0;
  if (s.mounted && !s.sending) prepare(s); else emit();
}

// Al salir de la cuenta no queda nada de lo preparado ni de lo enviado.
onClear(() => { scopes.clear(); pending.clear(); burned.clear(); lastSent = null; notifySent(); emit(); });

/** Copia en el mismo toque; sin portapapeles moderno (conexión no segura), con el método antiguo. */
export function copyNow(text) {
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => legacy());
  return Promise.resolve(legacy());
}

const CLOSED = [403, 404, 409]; // anulada, ya usada o de otra cuenta: no sirve volver a marcarla

/**
 * Marca entregada la invitación preparada. El aviso sale con keepalive en el mismo toque (sigue aunque se abra
 * WhatsApp); el cambio en pantalla espera un instante para que el enlace tocado conserve su dirección. La siguiente
 * se prepara cuando el servidor ya registró la entrega o, sin respuesta en 8 segundos, llevándola en la preparación.
 */
function markSent(s, { label, role, cabeza, via, text }) {
  const l = s?.link;
  if (!l || s.sending) return;
  s.sending = true;
  pending.add(l.id);
  burned.add(l.id);
  channel?.postMessage({ sent: l.id });
  const sent = fetch(`/api/links/${l.id}/sent`, {
    method: 'POST', keepalive: true, credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(label ? { label } : {}),
  }).then(async (r) => {
    const d = await r.json().catch(() => null);
    if (r.ok || CLOSED.includes(r.status)) pending.delete(l.id);
    if (r.ok) return d;
    return CLOSED.includes(r.status) ? { closed: true } : null;
  }, () => null);
  haptic('success');
  const shown = new Promise((resolve) => setTimeout(() => {
    s.link = null;
    lastSent = { id: l.id, token: l.token, role, label, cabeza, via, text, typeId: s.typeId, headId: s.headId, at: Date.now(),
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString() };
    notifySent();
    emit();
    resolve();
  }, 60));
  const answer = Promise.race([sent, new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
  Promise.all([shown, answer]).then(([, d]) => {
    if (d && lastSent?.id === l.id) {
      // Anulada mientras estaba preparada, o ya entregada desde otra pestaña: se avisa en lugar de «enviada».
      if (d.closed) lastSent = { ...lastSent, closed: true };
      else if (d.already_sent) lastSent = { ...lastSent, duplicate: true };
      if (d.expires_at) lastSent = { ...lastSent, expires_at: d.expires_at };
      notifySent();
    }
    if (d?.stats) s.stats = d.stats;
    invalidate('links:');
    s.sending = false;
    prepare(s);
  });
}

/**
 * Invitación de un solo uso de un tipo (cabeza o líder) y, para líderes, de una cabeza.
 * - text(label?): el mensaje con el enlace; href(label?, phone?): el enlace de WhatsApp.
 * - onSend(label?): llámelo en el onClick del enlace de WhatsApp (no evite la navegación).
 * - copy(label?) y share(label?): copiar el mensaje o compartirlo con otra app; también cuentan como envío.
 */
export function useOneTimeInvite({ typeId, headId, role, cabeza, enabled = true, makeText }) {
  useSyncExternalStore(subscribe, () => tick, () => tick);
  const ok = enabled && !!typeId && (role === 'head' || !!headId);
  const s = ok ? scope(typeId, headId) : null;

  useEffect(() => {
    if (!s) return undefined;
    s.mounted++;
    // Al abrir (o al volver a la app) se prepara la invitación; si se preparó hace más de un minuto, el servidor
    // confirma que sigue sirviendo (alguien pudo anular las sin usar desde otro celular).
    const check = () => {
      if (s.sending) return;
      if (!s.link) prepare(s);
      else if (Date.now() - s.at > 60e3) prepare(s, { quiet: true });
    };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { s.mounted--; document.removeEventListener('visibilitychange', onVisible); };
  }, [s]);

  const url = s?.link ? inviteUrl(s.link.token) : null;
  const text = useCallback((label) => (url ? makeText({ url, name: label }) : ''), [url, makeText]);
  const meta = { role, cabeza };
  return {
    ready: !!url,
    preparing: !!s?.loading || !!s?.sending,
    error: s?.error || null,
    stats: s?.stats || null,
    link: s?.link || null,
    url,
    text,
    retry: () => s && prepare(s),
    onSend: (label) => markSent(s, { ...meta, label, text: text(label), via: 'whatsapp' }),
    copy: (label) => {
      if (!url) return Promise.resolve(false);
      // El portapapeles se pide en el mismo toque (el iPhone lo exige).
      const t = text(label);
      return copyNow(t).then((done) => { if (done) markSent(s, { ...meta, label, text: t, via: 'copy' }); return done; });
    },
    share: (label) => {
      if (!url || !navigator.share) return Promise.resolve(false);
      const t = text(label);
      return navigator.share({ text: t })
        .then(() => { markSent(s, { ...meta, label, text: t, via: 'share' }); return true; }, () => false);
    },
    revokeOpen: async () => {
      const r = await api.post('/links/one-time/revoke-open', { reg_type_id: typeId, head_id: headId || null });
      forgetInvite(typeId, headId);
      invalidate('links:');
      return r;
    },
  };
}

/**
 * Enlace general (reutilizable) para personas: uno por tipo, cabeza y de quién cuelgan. `direct`: «Directo con John»
 * (headId es esa estructura y nadie más en medio: quienes se registren quedan con él).
 */
export function useGeneralLink({ typeId, headId, ownerId, direct = false }) {
  const [state, setState] = useState({ link: null, error: null, loading: false });
  useEffect(() => {
    const ready = !!(typeId && headId && (ownerId || direct));
    setState({ link: null, error: null, loading: ready });
    if (!ready) return undefined;
    let alive = true;
    api.post('/links/general', { reg_type_id: typeId, head_id: Number(headId), owner_person_id: direct ? null : Number(ownerId) })
      .then((link) => alive && setState({ link, error: null, loading: false }))
      .catch((error) => alive && setState({ link: null, error, loading: false }));
    return () => { alive = false; };
  }, [typeId, headId, ownerId, direct]);
  return { ...state, url: state.link ? inviteUrl(state.link.token) : null };
}
