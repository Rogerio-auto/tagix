/**
 * Barrel das rotas de privacidade/LGPD (F10-S02).
 *
 * `createPrivacyRouter()` expõe export (assíncrono) + forget (anonimização síncrona).
 * O orchestrator monta com `app.use(createPrivacyRouter())` no `app.ts`.
 */
export { createPrivacyRouter } from './privacy';
