'use client';

import { Bell } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useNotificationsStore } from './store';

/**
 * Sino de notificações (F53-S06) para a `TopBar`. Abre a central e exibe um badge
 * com o número de não-lidas (UX §2.4 — entrada óbvia por ícone universal).
 *
 * Acessível: `aria-label` descreve o estado; o badge é `aria-hidden` (a contagem
 * já vai no label). Alvo ≥ 44px via `touch-target`. Foco visível com `focus-ring`.
 */
export function NotificationBell(): React.JSX.Element {
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const unread = useNotificationsStore((s) => s.notifications.reduce((acc, n) => acc + (n.seen ? 0 : 1), 0));

  const label =
    unread > 0 ? `Notificações, ${unread} não lida${unread > 1 ? 's' : ''}` : 'Notificações';

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={label}
      aria-haspopup="dialog"
      className="touch-target relative grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className={cn(
            // `text-bg` é o inverso do tema: escuro sobre o vermelho claro do dark, claro sobre
            // o vermelho escuro do light (≥4,5:1 nos dois). Contagem em mono tabular.
            'absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-pill bg-danger px-1',
            'font-mono text-[0.625rem] font-semibold leading-none tabular-nums text-bg ring-2 ring-bg',
          )}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
