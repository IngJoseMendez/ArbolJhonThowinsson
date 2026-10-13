// Detección del entorno de despliegue.
export const ON_VERCEL = !!process.env.VERCEL;
export const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);
/** Producción: hosting gestionado o NODE_ENV=production. */
export const IS_PRODUCTION = ON_VERCEL || ON_RAILWAY || process.env.NODE_ENV === 'production';
