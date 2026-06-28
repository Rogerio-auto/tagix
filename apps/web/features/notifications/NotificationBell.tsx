'use client';

import { Bell } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useNotificationsStore } from './store';

/**
 * Sino de notificações (F53-S06) para a `TopBar`. Abre a central e exibe um badge
 * com o número de não-lidas (UX §2.4 — entrada óbvia por ícone universal).
 *
 * Acessível: `aria-label` descreve o estado; o badge é `aria-hidden` (a contagem
 * já vai no label). Alvo ≥ 44px via `touch-target`. Foco visível com `shadow-glow-md`.
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
      className="touch-target relative grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden
          className={cn(
            'absolute right-1 top-1 grid min-w-4 place-items-center rounded-pill bg-danger px-1 text-[0.625rem] font-semibold leading-none text-white',
            'h-4',
          )}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
