/**
 * @hm/web — frontend Next.js 15 (App Router) + React 19 + Tailwind 4.
 *
 * O scaffold real do Next (app/layout.tsx, providers TanStack/Theme/Toast,
 * Zustand stores, middleware Supabase, next.config.mjs com `output: 'standalone'`
 * e Dockerfile) entra em F0-S10 — com react/next/tailwind como dependências.
 * Até lá este módulo só registra metadados do app.
 */

export const WEB_APP = {
  name: '@hm/web',
  framework: 'next',
  router: 'app',
} as const;
