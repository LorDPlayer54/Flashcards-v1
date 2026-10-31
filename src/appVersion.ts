// Version de l'application, injectée au build depuis package.json (vite.config.ts, `define`).
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
