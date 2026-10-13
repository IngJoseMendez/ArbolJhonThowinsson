// Función serverless para proyectos de Vercel cuyo "Root Directory" es `client`.
// Es la misma API que /api/index.js (la configuración recomendada es Root Directory vacío).
import { createApp } from '../../server/app.js';

const app = createApp();
export default app;
