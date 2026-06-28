'use client';

import { useEffect } from 'react';
import { BellOff, Trash2 } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useAppointmentDue } from '@/shared/realtime/useAppointmentDue';
import { groupByContact, useNotificationsStore } from './store';
import { useNotificationSound } from './useNotificationSound';
import { NotificationItem } from './NotificationItem';
import type { AppNotification } from './types';

/**
 * Central de notificações persistente (F53-S06). Montada UMA vez no `AppLayout`
 * (ao lado do `CommandPalette`).
 *
 * - Assina `appointment:due` (`useAppointmentDue`) e dispara o som (`useNotificationSound`).
 * - Persiste a lista até o operador descartar/concluir (UX §2.12 — nível inbox).
 * - Agrupa por contato; mostra empty state quando vazia (UX §2.6).
 * - Mobile: bottom-sheet (alvos ≥ 44px, swipe/Esc). Desktop: popover ancorado ao topo.
 */
export function NotificationCenter(): React.JSX.Element {
  const { isMobile } = useBreakpoint();
  const open = useNotificationsStore((s) => s.open);
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const clear = useNotificationsStore((s) => s.clear);
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const notifications = useNotificationsStore((s) => s.notifications);

  // Hidrata lista + prefs do localStorage (uma vez, client-side).
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Liga o pipeline realtime + som (montados uma única vez aqui).
  useAppointmentDue();
  useNotificationSound();

  const groups = groupByContact(notifications);
  const close = (): void => setOpen(false);

  const body =
    notifications.length === 0 ? (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <BellOff className="size-8 text-text-low" aria-hidden />
        <p className="font-head text-sm font-semibold text-text">Tudo em dia</p>
        <p className="max-w-[16rem] text-xs text-text-mid">
          Lembretes de compromissos aparecem aqui no horário certo. Nada pendente agora.
        </p>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <NotificationGroupBlock key={g.key} items={g.items} />
        ))}
      </div>
    );

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="font-head text-sm font-semibold text-text">Notificações</span>
      {notifications.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="touch-target inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
        >
          <Trash2 className="size-3.5" />
          Limpar todas
        </button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onClose={close} variant="bottom" title="Notificações">
        <div className="flex flex-col gap-3 pt-1">
          {notifications.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={clear}
                className="touch-target inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
              >
                <Trash2 className="size-3.5" />
                Limpar todas
              </button>
            </div>
          )}
          {body}
        </div>
      </Sheet>
    );
  }

  return <DesktopPopover open={open} onClose={close} header={header} body={body} />;
}

/** Bloco de um contato: empilha seus lembretes; cabeçalho discreto quando há vários. */
function NotificationGroupBlock({ items }: { items: readonly AppNotification[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 1 && (
        <p className="px-0.5 text-xs font-medium text-text-low">
          {items.length} lembretes deste contato
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {items.map((n) => (
          <NotificationItem key={n.eventId} n={n} />
        ))}
      </ul>
    </div>
  );
}

/** Popover desktop ancorado ao topo-direito (sob o sino). Esc/clique-fora fecham. */
function DesktopPopover({
  open,
  onClose,
  header,
  body,
}: {
  open: boolean;
  onClose: () => void;
  header: React.ReactNode;
  body: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Camada de clique-fora (transparente). */}
      <button
        type="button"
        aria-label="Fechar notificações"
        onClick={onClose}
        className="absolute inset-0 cursor-default outline-none"
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Notificações"
        className="absolute right-4 top-16 flex max-h-[70dvh] w-[22rem] flex-col rounded-lg border border-border bg-bg shadow-elev-4 motion-safe:animate-[hm-fade-in_150ms_ease-out]"
      >
        <div className="border-b border-border px-4 py-3">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{body}</div>
      </div>
    </div>
  );
}
