'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronUp, LogOut, Settings } from 'lucide-react';
import type { Role } from '@hm/shared';
import { api } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { cn } from '@/shared/lib/cn';

/** Rótulos PT-BR dos papéis (a API expõe o enum em maiúsculas). */
const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Agente',
  READONLY: 'Somente leitura',
};

/** Iniciais a partir do nome (sem avatar no store — UX §2.4: identidade legível). */
export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Purga intencional da sessão (logout): espelha o mecanismo central de expiry
 * (`handleSessionExpired`) — zera auth, derruba o socket, limpa os caches — mas
 * redireciona para `/login` SEM `?next=`, porque NÃO é expiração: o usuário pediu
 * para sair (UX §2.7 — redirect limpo, sem loop de volta à rota anterior).
 */
function purgeAndRedirectToLogin(queryClient: { clear: () => void }): void {
  if (typeof window === 'undefined') return;
  useAuthStore.getState().setAuth(null);
  const sock = window.__hmSocket as { disconnect?: () => void } | undefined;
  try {
    sock?.disconnect?.();
  } catch {
    // Socket já caiu — vamos recarregar a página de qualquer forma.
  }
  queryClient.clear();
  window.location.assign('/login');
}

export interface UserMenuProps {
  name: string;
  role: Role;
  /**
   * Direção de abertura do menu. `up` (default) ancora no rodapé da Sidebar;
   * `down` ancora num gatilho no topo (TopBar mobile).
   */
  placement?: 'up' | 'down';
  /** Estilo do gatilho: `block` (bloco de perfil largo) ou `compact` (só avatar). */
  variant?: 'block' | 'compact';
  /**
   * Sidebar recolhida: força o gatilho a só-avatar (centralizado) e abre o
   * dropdown ancorado à esquerda (para a direita, sobre o conteúdo). O dropdown
   * passa a exibir o cabeçalho de identidade (nome/papel), como no `compact`.
   */
  collapsed?: boolean;
}

/**
 * Menu de identidade + sessão. Gatilho mostra o avatar (iniciais) e, no modo
 * `block`, nome + papel. Abre um dropdown com "Perfil e configurações" (→
 * `/settings`) e "Sair" (logout com loading). Fecha por Esc e clique-fora; foco
 * com ring visível. UX §2.4 (path óbvio p/ perfil+logout), §2.7 (feedback +
 * redirect limpo), §8 (paridade mobile via `variant`/`placement`).
 */
export function UserMenu({
  name,
  role,
  placement = 'up',
  variant = 'block',
  collapsed = false,
}: UserMenuProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const initials = initialsFromName(name);
  const roleLabel = ROLE_LABEL[role];

  // Fecha por clique-fora e por Esc enquanto aberto.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleLogout(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Encerra a sessão no servidor (limpa o cookie httpOnly). Mesmo se falhar
      // (rede), seguimos com a purga local — fail-safe: nunca deixar "meio logado".
      await api.post('/auth/logout');
    } catch {
      // Best-effort: a purga local + redirect acontece de qualquer forma.
    } finally {
      purgeAndRedirectToLogin(queryClient);
    }
  }

  const Avatar = (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 font-head text-xs font-semibold text-text"
    >
      {initials}
    </span>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={collapsed ? `${name} · ${roleLabel}` : undefined}
        className={cn(
          'group flex items-center rounded-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
          collapsed
            ? 'w-full justify-center py-2 hover:bg-surface-2'
            : variant === 'block'
              ? 'w-full gap-3 px-2 py-2 text-left hover:bg-surface-2'
              : 'touch-target justify-center text-text-mid hover:text-text',
        )}
      >
        {Avatar}
        {variant === 'block' && !collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-head text-sm font-medium text-text">{name}</span>
              <span className="truncate text-xs text-text-low">{roleLabel}</span>
            </span>
            <ChevronUp
              className={cn(
                'size-4 shrink-0 text-text-low transition-transform duration-200',
                open ? '' : 'rotate-180',
              )}
              aria-hidden
            />
          </>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Conta"
          className={cn(
            'absolute right-0 z-20 overflow-hidden rounded-sm border border-border bg-surface-2 py-1 shadow-lg',
            // `block` ocupa a largura do gatilho (rodapé da Sidebar); `compact`
            // abre um popover de largura fixa ancorado à direita (TopBar mobile).
            // `collapsed` (sidebar recolhida) ancora à esquerda e abre p/ a direita.
            collapsed ? 'left-0 w-56' : variant === 'block' ? 'left-0' : 'w-56',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {(variant === 'compact' || collapsed) && (
            <div className="border-b border-border px-3 py-2">
              <p className="truncate font-head text-sm font-medium text-text">{name}</p>
              <p className="truncate text-xs text-text-low">{roleLabel}</p>
            </div>
          )}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2 font-head text-sm text-text-mid outline-none transition-colors duration-150 hover:bg-surface-3 hover:text-text focus-visible:bg-surface-3 focus-visible:text-text focus-visible:shadow-glow-md"
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            Perfil e configurações
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={signingOut}
            aria-busy={signingOut}
            className="flex w-full items-center gap-3 px-3 py-2 font-head text-sm text-text-mid outline-none transition-colors duration-150 hover:bg-surface-3 hover:text-text focus-visible:bg-surface-3 focus-visible:text-text focus-visible:shadow-glow-md disabled:cursor-wait disabled:opacity-70"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            {signingOut ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      )}
    </div>
  );
}
