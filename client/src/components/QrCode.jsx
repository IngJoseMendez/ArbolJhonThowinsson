import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Código QR como SVG de un solo trazo (sin imágenes ni HTML insertado), con su margen blanco para la cámara. */
export default function QrCode({ text, size = 196, label }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { n: count, d: path };
  }, [text]);
  const m = 3;
  return (
    <svg className="qr" width={size} height={size} viewBox={`${-m} ${-m} ${n + 2 * m} ${n + 2 * m}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-m} y={-m} width={n + 2 * m} height={n + 2 * m} fill="#fff" />
      <path d={d} fill="#05204a" />
    </svg>
  );
}
