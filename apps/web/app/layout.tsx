import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Chakra_Petch, Manrope, Orbitron, Rajdhani } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const head = Rajdhani({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-head-next', display: 'swap' });
const body = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body-next', display: 'swap' });
const price = Chakra_Petch({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-price-next', display: 'swap' });
const display = Orbitron({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display-next', display: 'swap' });

export const metadata: Metadata = {
  title: 'Highermind',
  description: 'Atendimento ao cliente, vendas conversacionais e automação.',
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
