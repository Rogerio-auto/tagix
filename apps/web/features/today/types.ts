/**
 * Tipos da fila "Aguardando resposta" e da agenda do dia (`GET /api/dashboard/today`).
 * Espelham `apps/api/src/routes/dashboard/today.ts`. `month` vem `null` para quem não
 * é gestão: o servidor não entrega resultado da empresa a AGENT/READONLY.
 */
export type UrgencyBand = 'esfriando' | 'atencao' | 'agora';

export interface WaitingLead {
  readonly conversationId: string;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly preview: string | null;
  readonly waitingSince: string;
  readonly waitingMinutes: number;
  readonly channel: string;
  readonly urgency: UrgencyBand;
}

export interface TodayAppointment {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly contactName: string | null;
}

export interface TodayPayload {
  readonly waiting: readonly WaitingLead[];
  readonly waitingTotal: number;
  readonly waitingBands: Readonly<Record<UrgencyBand, number>>;
  readonly appointments: readonly TodayAppointment[];
  readonly month: {
    readonly leads: number;
    readonly leadsPrevious: number;
    readonly appointments: number;
    readonly appointmentsPrevious: number;
    readonly conversations: number;
    readonly conversationsPrevious: number;
  } | null;
  readonly serverTime: string;
}
