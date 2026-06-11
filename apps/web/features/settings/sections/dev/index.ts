/**
 * Barrel da seção Settings → Dev (F9-S06). O registry do shell (F8-S05) importa
 * `DevSection` via `lazy(() => import('../sections/dev/DevSection'))`.
 */
export { default } from './DevSection';
export { default as DevSection } from './DevSection';
export { default as ApiKeysManager } from './ApiKeysManager';
export { default as WebhooksManager } from './WebhooksManager';
