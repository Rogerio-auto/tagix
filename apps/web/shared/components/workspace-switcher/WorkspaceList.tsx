'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ROLE_LABEL, workspaceInitial } from './labels';
import { workspaceShortcutLabel } from './shortcuts';
import { useWorkspaceSwitcher } from './useWorkspaceSwitcher';

const ITEM_SELECTOR = '[role="menuitemradio"]';

export interface WorkspaceListProps {
  /** Chamado quando a escolha termina com sucesso (ex.: fechar o menu). */
  onSelected?: () => void;
  /** Foca a empresa ativa ao montar (menu aberto por teclado). */
  autoFocus?: boolean;
  className?: string;
}

/**
 * Lista de empresas da pessoa: papel em cada uma, check na ativa, atalho
 * `Alt+Shift+N` à direita. Teclado: setas/Home/End movem o foco, `1..9` escolhe,
 * Enter/Espaço confirma. Estado da troca: spinner no item de destino, resto
 * bloqueado; erro vira `role="alert"` com o que fazer (UX §2.11).
 */
export function WorkspaceList({ onSelected, autoFocus = false, className }: WorkspaceListProps) {
  const { memberships, activeId, busy, pendingId, error, clearError, switchTo } =
    useWorkspaceSwitcher();
  const listRef = useRef<HTMLDivElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform));
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const first = listRef.current?.querySelector<HTMLButtonElement>(ITEM_SELECTOR);
    const active = listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (active ?? first)?.focus();
  }, [autoFocus]);

  async function choose(workspaceId: string): Promise<void> {
    if (busy) return;
    if (workspaceId === activeId) {
      onSelected?.();
      return;
    }
    const ok = await switchTo(workspaceId);
    if (ok) onSelected?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const at = items.findIndex((el) => el === document.activeElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const target = memberships[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        void choose(target.workspaceId);
      }
    }
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="group"
        aria-label="Suas empresas"
        onKeyDown={onKeyDown}
        className="flex flex-col gap-0.5"
      >
        {memberships.map((m, i) => {
          const active = m.workspaceId === activeId;
          const pending = pendingId === m.workspaceId;
          const shortcut = workspaceShortcutLabel(i, isMac);
          const inactiveSub =
            m.subscriptionStatus === 'expired' || m.subscriptionStatus === 'canceled';
          return (
            <button
              key={m.workspaceId}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-busy={pending}
              disabled={busy && !pending}
              onClick={() => void choose(m.workspaceId)}
              className={cn(
                'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left outline-none',
                'transition-colors duration-150 focus-visible:shadow-glow-md',
                'hover:bg-surface-3 focus-visible:bg-surface-3 disabled:cursor-wait disabled:opacity-60',
                active && 'bg-surface-3',
              )}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface font-head text-sm font-semibold text-text"
              >
                {workspaceInitial(m.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-head text-sm font-medium text-text">{m.name}</span>
                {/* Atalho na linha do papel, não na do nome: o chip ao lado do nome
                    comia ~70 px e truncava empresas curtas ("Studio V…") na Sidebar. */}
                <span className="flex min-w-0 items-center gap-2 text-xs text-text-low">
                  <span className="min-w-0 flex-1 truncate">
                    {ROLE_LABEL[m.role]}
                    {inactiveSub && <span className="text-warn"> · Só leitura</span>}
                  </span>
                  {shortcut && !pending && !active && (
                    <kbd className="hidden shrink-0 rounded-xs border border-border px-1 font-mono text-[10px] leading-4 text-text-low md:inline">
                      {shortcut}
                    </kbd>
                  )}
                </span>
              </span>
              {pending ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-text-mid motion-reduce:animate-none"
                  aria-label="Trocando"
                />
              ) : active ? (
                <Check className="size-4 shrink-0 text-text" aria-label="Empresa ativa" />
              ) : null}
            </button>
          );
        })}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-text"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 rounded-xs font-medium text-text-mid underline-offset-2 outline-none hover:text-text hover:underline focus-visible:shadow-glow-md"
          >
            Ok
          </button>
        </div>
      )}
    </div>
  );
}
