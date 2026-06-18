/**
 * Barrel das rotas de plataforma da fase F38 (SUPPORT.md). Re-exporta os routers
 * gated por requirePlatformAdmin para o wire em app.ts (responsabilidade do
 * orchestrator). Os routers F25/F26 ja existentes sao importados direto no app.ts;
 * este barrel agrega só os novos da F38 para manter o app.ts enxuto.
 */
export { createPlatformHelpRouter } from './help';
export { createPlatformSupportRouter } from './support';
