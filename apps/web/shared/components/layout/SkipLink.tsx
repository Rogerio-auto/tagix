import { cn } from '@/shared/lib/cn';

/**
 * Skip-to-content (WCAG 2.4.1 — Bypass Blocks). Primeiro elemento focável da
 * página: invisível até receber foco por Tab, quando salta para o `<main>`.
 * Permite ao usuário de teclado/leitor de tela pular a sidebar repetida.
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only z-[80] rounded-sm bg-surface px-4 py-2 font-head text-sm font-semibold text-text',
        'shadow-elev-3 outline-none',
        // Vira visível e ancorado no topo-esquerdo apenas quando focado.
        'focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4',
        'focus-visible:shadow-glow-md',
      )}
    >
      Pular para o conteúdo
    </a>
  );
}
