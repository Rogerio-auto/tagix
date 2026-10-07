'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { workspaceInitial } from './labels';
import { WorkspaceList } from './WorkspaceList';
import { useWorkspaceSwitcher } from './useWorkspaceSwitcher';

export interface WorkspaceSwitcherProps {
  /** Sidebar recolhida: só a marca; o nome vai em tooltip e no nome acessível. */
  collapsed?: boolean;
}

/**
 * Cabeçalho da Sidebar: marca + NOME DA EMPRESA ATIVA, sempre visível. Com 2+
 * empresas vira o gatilho de um menu de troca; com 1 é só rótulo (sem chevron,
 * sem botão — não finge uma ação que não existe).
 */
export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps) {
  const { activeName, canSwitch } = useWorkspaceSwitcher();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const mark = (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-xs bg-surface-3 font-head text-xs font-semibold text-text"
    >
      {activeName ? workspaceInitial(activeName) : null}
    </span>
  );
  const name = (
    <span
      className={cn(
        'min-w-0 overflow-hidden whitespace-nowrap text-left font-head text-sm font-semibold text-text transition-all duration-200 motion-reduce:transition-none',
        collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-2.5 flex-1 opacity-100',
      )}
    >
      {activeName ? (
        <span className="block truncate">{activeName}</span>
      ) : (
        <span
          aria-hidden
          className="block h-4 w-24 animate-pulse rounded-xs bg-surface-3 motion-reduce:animate-none"
        />
      )}
    </span>
  );
  // Cartão da empresa (maquete `.workspace-switch`): borda hairline + `surface-2`.
  const rowClass = cn(
    'flex h-11 w-full items-center rounded-sm border border-border bg-surface-2',
    collapsed ? 'justify-center px-0' : 'px-2',
  );

  if (!canSwitch) {
    return (
      <div className={rowClass} title={activeName || undefined}>
        {mark}
        {name}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Empresa ativa: ${activeName || 'carregando'}. Trocar de empresa`}
        title={activeName || undefined}
        className={cn(
          rowClass,
          'outline-none transition-colors duration-200 hover:border-border-2 hover:bg-surface-3 focus-visible:focus-ring',
        )}
      >
        {mark}
        {name}
        {!collapsed && (
          <ChevronsUpDown className="ml-1 size-4 shrink-0 text-text-low" aria-hidden />
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Trocar de empresa"
          className={cn(
            'absolute top-full z-30 mt-1 rounded-sm border border-border-2 bg-surface-2 p-1 shadow-ds-2',
            collapsed ? 'left-0 w-64' : 'inset-x-0',
          )}
        >
          <p className="px-2 pb-1 pt-1.5 font-head text-xs font-medium uppercase tracking-wide text-text-low">
            Suas empresas
          </p>
          <WorkspaceList autoFocus onSelected={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
