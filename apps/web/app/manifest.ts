import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (PWA instalável — MOBILE_UX §8). Cores espelham os tokens DS
 * v2 dark-first: `--bg` (#050505) e `--brand` (#1fff13). Manifest é JSON estático,
 * não pode referenciar CSS vars; manter sincronizado com `tokens.css` se mudarem.
 *
 * Ícones maskable provisórios (gerados como SVG→PNG monocromáticos com a marca)
 * vivem em `public/icons/**` — substituir por arte final na auditoria (F36-S14).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Leadium',
    short_name: 'Leadium',
    description: 'Atendimento ao cliente, vendas conversacionais e automação.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'pt-BR',
    dir: 'ltr',
    background_color: '#050505',
    theme_color: '#050505',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
