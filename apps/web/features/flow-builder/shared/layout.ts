/**
 * Geometria do editor de flow (F72-S07). Módulo sem 'use client': usado também pelo
 * 'loading.tsx' da rota (Server Component).
 */

/**
 * O editor ocupa toda a área do `<main>`, de borda a borda: anula o gutter do shell
 * (`px-4 py-5` / `md:px-8 md:py-8` no AppLayout) e mede a altura pelo próprio `<main>`.
 * Antes, `100vh - 3.5rem` ignorava o gutter e a barra superior, e o canvas vazava pela
 * base (controles e minimapa cortados).
 */
export const EDITOR_BLEED = '-mx-4 -my-5 h-[calc(100%+2.5rem)] md:-mx-8 md:-my-8 md:h-[calc(100%+4rem)]';
