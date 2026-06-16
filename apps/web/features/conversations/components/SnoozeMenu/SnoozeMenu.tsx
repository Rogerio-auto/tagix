'use client';

/**
 * Menu de adiar (snooze) com durações reais — substitui o placeholder de "1h fixa".
 * Reutilizado pelo cockpit (`ContactInfoPanel`, variant 'button') e pelo header
 * espelho (`ConversationHeader`, variant 'icon'). Dispara o `/status` com
 * `snoozedUntil` calculado por opção.
 *
 * DS v2: zero hex, só tokens; focus ring `focus-visible:shadow-glow-md`;
 * click-outside fecha; `motion-safe` no chevron.
 */

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { useChangeStatus } from '../../queries';

interface SnoozeOption {
  readonly label: string;
  readonly compute: () => Date;
}

/** Retorna uma cópia de `d` no horário `hour:00:00.000` local. */
function atHour(d: Date, hour: number): Date {
  const x = new Date(d);
  x.setHours(hour, 0, 0, 0);
  return x;
}

const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { label: '1 hora', compute: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: '3 horas', compute: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: 'Amanhã, 9h',
    compute: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return atHour(d, 9);
    },
  },
  {
    label: 'Próxima semana',
    compute: () => {
      const d = new Date();
      // Próxima segunda-feira (1). `((8 - day) % 7) || 7` cai sempre na próxima.
      const add = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + add);
      return atHour(d, 9);
    },
  },
];

const untilFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export interface SnoozeMenuProps {
  conversationId: string;
  /** 'button' = botão rotulado (cockpit); 'icon' = ícone só (header espelho). */
  variant?: 'button' | 'icon';
  disabled?: boolean;
}

export function SnoozeMenu({ conversationId, variant = 'button', disabled }: SnoozeMenuProps) {
  const { toast } = useToast();
  const changeStatus = useChangeStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function pick(option: SnoozeOption): void {
    if (changeStatus.isPending) return;
    const until = option.compute();
    changeStatus.mutate(
      { conversationId, status: 'snoozed', snoozedUntil: until.toISOString() },
      {
        onSuccess: () => {
          toast({ title: `Adiada até ${untilFmt.format(until)}`, variant: 'success' });
          setOpen(false);
        },
        onError: () => toast({ title: 'Falha ao adiar', variant: 'error' }),
      },
    );
  }

  const isBusy = disabled || changeStatus.isPending;

  return (
    <div ref={ref} className="relative">
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label="Adiar conversa"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Adiar conversa"
          disabled={isBusy}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'rounded-sm p-2 text-text-low outline-none transition-colors',
            'hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Clock className="size-5" aria-hidden />
        </button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={changeStatus.isPending}
          disabled={isBusy}
          aria-haspopup="menu"
          aria-expanded={open}
          leftIcon={<Clock className="size-3.5" aria-hidden />}
          onClick={() => setOpen((v) => !v)}
        >
          Adiar
        </Button>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Adiar por"
          className={cn(
            'absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-border bg-surface-2 p-1 shadow-glow-md',
            variant === 'icon' ? 'top-full' : 'bottom-full mb-1',
          )}
        >
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              disabled={changeStatus.isPending}
              onClick={() => pick(option)}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-left font-body text-sm text-text-mid outline-none',
                'hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
