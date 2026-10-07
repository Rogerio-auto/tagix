'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isEditableTarget, workspaceShortcutIndex } from './shortcuts';
import { useSwitchStore } from './switch.store';
import { useWorkspaceSwitcher } from './useWorkspaceSwitcher';

/**
 * Montado UMA vez no shell. Faz duas coisas:
 *  - atalhos globais `Alt+Shift+1..9` para trocar de empresa (UX §2.10);
 *  - cortina de transição enquanto a troca acontece: o conteúdo da empresa anterior
 *    nunca fica visível com o cookie já da nova (sem vazar dado na tela).
 */
export function WorkspaceSwitchHost() {
  const { memberships, canSwitch, switchTo } = useWorkspaceSwitcher();
  const phase = useSwitchStore((s) => s.phase);
  const targetName = useSwitchStore((s) => s.targetName);
  const finish = useSwitchStore((s) => s.finish);
  const pathname = usePathname();

  useEffect(() => {
    if (!canSwitch) return;
    function onKeyDown(e: KeyboardEvent): void {
      const index = workspaceShortcutIndex(e);
      if (index === null || isEditableTarget(e.target)) return;
      const target = memberships[index];
      if (!target) return;
      e.preventDefault();
      void switchTo(target.workspaceId);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSwitch, memberships, switchTo]);

  // Levanta a cortina quando a navegação para `/` assentou (ou, no pior caso, após
  // um teto de tempo — a cortina nunca prende a pessoa).
  useEffect(() => {
    if (phase !== 'navigating') return;
    const settle = pathname === '/' ? window.setTimeout(finish, 350) : null;
    const cap = window.setTimeout(finish, 5_000);
    return () => {
      if (settle !== null) window.clearTimeout(settle);
      window.clearTimeout(cap);
    };
  }, [phase, pathname, finish]);

  if (phase === 'idle') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] grid place-items-center bg-bg/90 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-5 py-3 shadow-lg">
        <Loader2 className="size-4 animate-spin text-text-mid motion-reduce:animate-none" aria-hidden />
        <p className="font-head text-sm text-text">
          {targetName ? `Entrando em ${targetName}…` : 'Trocando de empresa…'}
        </p>
      </div>
    </div>
  );
}
