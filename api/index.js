// Función serverless de Vercel: toda la API (/api/*) la atiende la app Express.
// El cliente (client/dist) lo sirve Vercel como sitio estático.
import { createApp } from '../server/app.js';

const app = createApp();
export default app;
