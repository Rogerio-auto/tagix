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
        // Mobile: conteúdo no topo (espaço pro teclado). Lateral = o MAIOR entre o
        // respiro de 20 px e a safe-area: `pl-safe`/`pr-safe` sozinhos zeravam o `px-5`
        // fora de notch e colavam o formulário na borda a 375 px.
        'justify-start pt-safe-4 pb-safe-4',
        'pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]',
        // md+: volta ao card centrado, sem o offset do topo.
        'md:items-center md:justify-center md:p-6',
      ].join(' ')}
    >
      {children}
    </main>
  );
}
