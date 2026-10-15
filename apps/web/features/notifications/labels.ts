import { formatDateTime, formatTime } from '@/shared/lib/locale';
import type { AppNotification } from './types';

/**
 * Rótulos PT-BR dos tipos de compromisso (espelham o vocabulário da API F53-S02).
 * Definidos localmente de propósito: `features/cockpit-agenda` é fronteira proibida
 * deste slot, então não importamos `EVENT_TYPE_OPTIONS` de lá.
 */
const TYPE_LABELS: Record<string, string> = {
  follow_up: 'Follow-up',
  call: 'Ligação',
  whatsapp: 'WhatsApp',
  meeting: 'Reunião',
  billing: 'Cobrança',
  proposal: 'Envio de proposta',
  custom: 'Compromisso',
};

export function eventTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? 'Compromisso';
}

const PRIORITY_LABELS: Record<AppNotification['priority'], string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export function priorityLabel(priority: AppNotification['priority']): string {
  return PRIORITY_LABELS[priority];
}

/** Token de cor (classe Tailwind) do ponto de prioridade — sem hex. */
export function priorityDotClass(priority: AppNotification['priority']): string {
  switch (priority) {
    case 'high':
      return 'bg-danger';
    case 'medium':
      return 'bg-warn';
    case 'low':
    default:
      return 'bg-info';
  }
}

/** Horário do compromisso, legível ("Hoje 14:30" / "27 jun 14:30"), no idioma da interface. */
export function formatStartAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatTime(d);
  return sameDay ? `Hoje ${time}` : `${formatDateTime(d, { day: '2-digit', month: 'short' })} ${time}`;
}
