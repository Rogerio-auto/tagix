/**
 * Barrel client-safe da lib do painel de super-admin (F25-S06).
 * NAO reexporta `guard.ts` (server-only, usa next/headers) — o layout server-side
 * importa `resolvePlatformAdmin` direto de './guard'. Manter este barrel livre de
 * codigo server-only permite que Client Components o importem sem puxar next/headers.
 */
export * from './types';
export * from './client';
