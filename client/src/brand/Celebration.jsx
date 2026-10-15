import { useEffect, useRef } from 'react';
import { Heart } from 'lucide-react';
import { Logo, Mark, JohnPhoto, CAMPAIGN } from './Brand.jsx';
import { fmtDate, initials } from '../lib/format.js';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Lluvia de papelitos con los colores de la marca (y algún dorado de fiesta). Incluye pequeños dobles ángulos,
 * el símbolo de Thowinsson. Se dibuja una sola vez y se apaga sola; no se muestra con «reducir movimiento».
 */
function Confetti({ amount = 150, delay = 350 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reduceMotion()) return undefined;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0; let h = 0;
    const size = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const colors = ['#60b6e8', '#ffffff', '#9fd3f5', '#f4c542', '#60b6e8', '#ffffff', '#2f8fd3'];
    const pieces = Array.from({ length: amount }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? w * 0.18 : w * 0.82,
        y: h * 0.42,
        vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 6.5) + (Math.random() - 0.5) * 3,
        vy: -(7 + Math.random() * 9),
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        s: 5 + Math.random() * 6,
        c: colors[i % colors.length],
        shape: i % 9 === 0 ? 'mark' : i % 3 === 0 ? 'dot' : 'rect',
        wobble: Math.random() * 10,
      };
    });
    let raf = 0; let start = 0;
    const draw = (t) => {
      if (!start) start = t;
      const age = t - start;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of pieces) {
        p.vy += 0.24; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx + Math.sin((age / 300) + p.wobble) * 0.6; p.y += p.vy; p.r += p.vr;
        if (p.y > h + 20) continue;
        alive++;
        const fade = age > 2600 ? Math.max(0, 1 - (age - 2600) / 900) : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(0, 0, p.s / 2.4, 0, Math.PI * 2); ctx.fill(); }
        else if (p.shape === 'mark') {
          const k = p.s / 9;
          ctx.fillRect(-4 * k, -6 * k, 9 * k, 2.6 * k); ctx.fillRect(2.4 * k, -6 * k, 2.6 * k, 9 * k);
        } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (alive && age < 3600) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(draw); }, delay);
    window.addEventListener('resize', size);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); window.removeEventListener('resize', size); };
  }, [amount, delay]);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}

/** Credencial de cabeza o de líder: el «carné» del equipo, con la foto de John. */
export function Credential({ role, name, typeName, team, code, since }) {
  return (
    <div className={`credential credential-${role}`}>
      <div className="credential-glow" aria-hidden="true" />
      <Mark className="credential-watermark" />
      <div className="credential-top">
        <Logo tone="sky" className="credential-logo" />
        <span className="credential-john"><JohnPhoto variant="face" eager alt="" /></span>
      </div>
      <div className="credential-body">
        <span className="credential-avatar" aria-hidden="true">{initials(name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="credential-role">
            {role === 'head' ? 'Cabeza' : 'Líder'}
            {typeName && typeName !== (role === 'head' ? 'Cabeza' : 'Líder') && <span className="credential-type">{typeName}</span>}
          </div>
          <div className="credential-name">{name}</div>
          <div className="credential-team">{team}</div>
        </div>
      </div>
      <div className="credential-foot">
        <span className="mono">{code}</span>
        <span>Desde el {fmtDate(since)}</span>
      </div>
      <div className="credential-sheen" aria-hidden="true" />
    </div>
  );
}

/**
 * Bienvenida tras registrarse. Cabezas y líderes reciben su credencial con una lluvia de papelitos y el doble
 * ángulo que sube; las personas, un agradecimiento con un corazón que late.
 */
export default function Celebration({ role, firstName, name, typeName, team, code, since, pending, children }) {
  const big = role === 'head' || role === 'leader';
  const title = pending ? `¡Gracias, ${firstName}!`
    : role === 'head' ? `¡Ya eres cabeza, ${firstName}!`
      : role === 'leader' ? `¡Ya eres líder, ${firstName}!`
        : `¡Gracias por sumarte, ${firstName}!`;
  return (
    <section className={`celebrate ${big ? 'celebrate-big' : ''}`} aria-live="polite">
      {!pending && <Confetti amount={big ? 170 : 80} />}
      <div className="celebrate-rise" aria-hidden="true"><Mark duo size={56} /></div>
      {big && !pending ? (
        <Credential role={role} name={name} typeName={typeName} team={team} code={code} since={since} />
      ) : (
        <div className="thanks-seal" aria-hidden="true">
          <JohnPhoto variant="face" eager alt="" />
          <span className="thanks-heart"><Heart size={20} fill="currentColor" /></span>
        </div>
      )}
      <h2 className="celebrate-title">{title}</h2>
      <div className="celebrate-sub">{children}</div>
      <p className="celebrate-love"><Heart size={14} fill="currentColor" aria-hidden="true" />Gracias por creer en este camino.</p>
      <p className="celebrate-sign">Equipo {CAMPAIGN}</p>
    </section>
  );
}
