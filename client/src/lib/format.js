const dtf = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' });
const dtfShort = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const dtt = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const nf = new Intl.NumberFormat('es');

/** «14 oct» en el año en curso; «14 oct 2025» si es de otro año. */
export const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.getFullYear() === new Date().getFullYear() ? dtfShort.format(d) : dtf.format(d);
};
export const fmtDateTime = (s) => (s ? dtt.format(new Date(s)) : '—');
export const fmtNum = (n) => nf.format(n ?? 0);

export function relTime(s) {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`;
  return fmtDate(s);
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const STATUS = {
  active: { label: 'Activa', tone: 'good' },
  pending: { label: 'Pendiente', tone: 'warning' },
  inactive: { label: 'Inactiva', tone: 'muted' },
  rejected: { label: 'Rechazada', tone: 'critical' },
};

export const METHOD = { manual: 'Registro manual', invitation: 'Enlace de invitación' };

export const inviteUrl = (token) => `${window.location.origin}/registro/${token}`;

export function phoneDisplay(p) {
  if (!p) return '—';
  if (p.includes('*')) return p;
  return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
}

// Paleta categórica validada (orden fijo) para colores de cabezas.
export const HEAD_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
