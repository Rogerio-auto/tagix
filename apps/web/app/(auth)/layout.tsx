import type { ReactNode } from 'react';

/**
 * Casca das telas de auth — primeira tela do produto, capricha no mobile.
 *
 * Mobile (< md): o conteúdo ocupa a largura toda com paddings confortáveis e
 * respeita a safe-area (notch/barra de gestos) em todos os lados. O bloco do
 * formulário sobe um pouco do centro geométrico (`justify-start` + offset) para
 * sobrar espaço quando o teclado virtual abre — o CTA continua visível.
 *
 * md+: layout original — card centrado vertical e horizontalmente.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className={[
        'flex min-h-dvh w-full flex-col bg-bg',
        // Mobile: conteúdo no topo (espaço pro teclado), com safe-area por lado.
        'justify-start pt-safe-4 pb-safe-4 pl-safe pr-safe px-5',
        // md+: volta ao card centrado, sem o offset do topo.
        'md:items-center md:justify-center md:p-6',
      ].join(' ')}
    >
      {children}
    </main>
  );
}
