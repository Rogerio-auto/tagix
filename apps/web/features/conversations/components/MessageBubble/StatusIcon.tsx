/**
 * Ícone de status de entrega de uma mensagem **outbound** (F1-S15).
 *
 * Mapeia `messages.view_status` para um ícone + rótulo acessível. Receipts
 * em tempo real (transição animada lida→não-lida etc.) são F1-S20 — aqui só
 * o estado renderizado a partir do dado atual.
 *
 * NB: este NÃO é `status.tsx` (arquivo reservado ao slot F1-S20).
 */
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { assertNever, type ViewStatus } from './types';

interface StatusVisual {
  Icon: LucideIcon;
  label: string;
  /** Classe de cor semântica do ícone. */
  tone: string;
}

function statusVisual(status: ViewStatus): StatusVisual | null {
  switch (status) {
    case 'pending':
    case 'sending':
      return { Icon: Clock, label: 'Enviando', tone: 'text-text-low' };
    case 'sent':
      return { Icon: Check, label: 'Enviada', tone: 'text-text-low' };
    case 'delivered':
      return { Icon: CheckCheck, label: 'Entregue', tone: 'text-text-low' };
    case 'read':
      return { Icon: CheckCheck, label: 'Lida', tone: 'text-brand' };
    case 'failed':
      return { Icon: AlertCircle, label: 'Falha no envio', tone: 'text-danger' };
    case 'deleted':
      // Mensagem apagada não exibe ícone de entrega.
      return null;
    default:
      return assertNever(status);
  }
}

export interface StatusIconProps {
  status: ViewStatus;
  className?: string;
}

/** Ícone de status outbound com rótulo somente-leitor. */
export function StatusIcon({ status, className }: StatusIconProps) {
  const visual = statusVisual(status);
  if (visual === null) return null;

  const { Icon, label, tone } = visual;

  return (
    <span className={cn('inline-flex items-center', tone, className)} data-status={status}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
