import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { osName } from '../../lib/device.js';
import { backTarget, useBack, useScreenTitle } from '../../lib/nav.js';

/** Botón «atrás»: en iPhone «‹ Título anterior» en celeste; en Android sólo la flecha. */
export function BackButton({ fallback, label }) {
  const back = useBack(fallback);
  const loc = useLocation();
  const text = label || backTarget(loc, fallback).label || 'Atrás';
  const ios = osName() === 'ios';
  return (
    <button type="button" className="m-bar__back" onClick={back} aria-label={ios ? `Volver a ${text}` : 'Atrás'}>
      {ios ? <ChevronLeft size={26} strokeWidth={2.2} aria-hidden="true" /> : <ArrowLeft size={24} aria-hidden="true" />}
      {ios && <span className="m-bar__back-label">{text.length > 14 ? `${text.slice(0, 13)}…` : text}</span>}
    </button>
  );
}

/** Botón redondo de la barra (buscar, ⋯…). */
export function BarButton({ icon: Icon, label, onClick, children, ...rest }) {
  return (
    <button type="button" className="m-icon-btn on-navy" aria-label={label} title={label} onClick={onClick} {...rest}>
      {Icon && <Icon size={22} aria-hidden="true" />}{children}
    </button>
  );
}

/**
 * Pantalla del celular: barra azul fija, cabecera azul con el título grande (se contrae al desplazar: el título pasa a
 * la barra) y el contenido en una hoja que sube sobre el azul.
 * - back: muestra «atrás» (con `back` como pantalla padre si se da una ruta).
 * - hero: contenido extra de la cabecera; heroTitle(ref): cabecera propia cuyo elemento `ref` hace de título grande.
 * - compactActions: acciones de la barra cuando la cabecera ya se ocultó (por ejemplo, «Invitar líder»).
 */
export default function Screen({
  title, count, back, left, actions, compactActions, hero, heroTitle, children, className = '', bodyClassName = '', stage, noHero,
}) {
  const titleRef = useRef(null);
  const barRef = useRef(null);
  const [collapsed, setCollapsed] = useState(!!noHero);
  useScreenTitle(title);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || noHero) return undefined;
    const bar = barRef.current?.offsetHeight || 64;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: `-${bar}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [noHero, title]);
  const showTitle = collapsed || noHero;
  return (
    <div className={`m-screen ${className}`}>
      <header ref={barRef} className={`m-bar ${stage ? 'm-bar--stage' : ''}`} data-collapsed={showTitle ? '' : undefined}>
        <div className="m-bar__row">
          <div className="m-bar__left">{back ? <BackButton fallback={typeof back === 'string' ? back : undefined} /> : left}</div>
          <div className="m-bar__title" aria-hidden={showTitle ? undefined : 'true'}>{title}</div>
          <div className="m-bar__actions">{collapsed && compactActions ? compactActions : actions}</div>
        </div>
      </header>
      {!noHero && (
        <div className={`m-hero ${stage ? 'm-hero--stage' : ''}`}>
          {heroTitle ? heroTitle(titleRef) : (
            <h1 ref={titleRef} className="m-hero__title">{title}{count !== undefined && count !== null && <span className="m-hero__count">{count}</span>}</h1>
          )}
          {hero}
        </div>
      )}
      <main className={`m-body ${noHero ? 'm-body--flat' : ''} ${bodyClassName}`}>{children}</main>
    </div>
  );
}
