import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Manrope, Orbitron, Rajdhani } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const head = Rajdhani({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-head-next', display: 'swap' });
const body = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body-next', display: 'swap' });
const price = Chakra_Petch({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-price-next', display: 'swap' });
const display = Orbitron({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display-next', display: 'swap' });

export const metadata: Metadata = {
  title: 'Leadium',
  description: 'Atendimento ao cliente, vendas conversacionais e automação.',
  // PWA: manifest gerado por app/manifest.ts (Next injeta o <link rel="manifest">).
  manifest: '/manifest.webmanifest',
  applicationName: 'Leadium',
  appleWebApp: {
    capable: true,
    title: 'Leadium',
    // Combina com o tema dark-first; a barra de status some no standalone.
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

// viewport-fit=cover é o que habilita env(safe-area-inset-*) (notch/barra de
// gestos) usado pelos utilitários .pt-safe/.pb-safe do shell mobile (S01).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // theme-color por esquema: pinta a barra do navegador/standalone com --bg.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#050505' },
    { media: '(prefers-color-scheme: light)', color: '#f4f7f4' },
  ],
};

// Aplica o tema antes do hydrate para não piscar (DESIGN_SYSTEM §9.4).
const themeScript = `(function(){try{var s=localStorage.getItem('hm:theme');var t=s||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${head.variable} ${body.variable} ${price.variable} ${display.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
