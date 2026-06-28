/**
 * Tipos da feature cockpit-agenda (F53-S03). Modal LEVE de agendamento rápido,
 * autocontido — reusa o hook `useCreateEvent` de features/calendar (não duplica
 * criação de evento).
 *
 * Os `type`/`priority` aqui espelham o vocabulário que a API (F53-S02) já aceita.
 * O `CreateEventInput` de features/calendar ainda não foi ampliado para os novos
 * `type` comerciais nem para `priority` — e aquele arquivo é fronteira proibida
 * deste slot. Por isso definimos o payload de forma estrita aqui e o estreitamos
 * no contrato do hook num único ponto documentado (ver QuickScheduleModal).
 */
import type { CreateEventInput } from '@/features/calendar/types';

/** Tipos de compromisso oferecidos no modal (mapeiam 1:1 aos `type` do schema). */
export type QuickEventType =
  | 'follow_up'
  | 'call'
  | 'whatsapp'
  | 'meeting'
  | 'billing'
  | 'proposal'
  | 'custom';

export interface QuickEventTypeOption {
  readonly value: QuickEventType;
  readonly label: string;
}

/** As 7 opções de tipo, na ordem do spec. */
export const EVENT_TYPE_OPTIONS: readonly QuickEventTypeOption[] = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'call', label: 'Ligação' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'billing', label: 'Cobrança' },
  { value: 'proposal', label: 'Envio de proposta' },
  { value: 'custom', label: 'Personalizado' },
];

export type EventPriority = 'low' | 'medium' | 'high';

export interface EventPriorityOption {
  readonly value: EventPriority;
  readonly label: string;
}

/** Baixa / Média / Alta. */
export const PRIORITY_OPTIONS: readonly EventPriorityOption[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
];

/**
 * Payload estrito que o modal monta. Amplia `CreateEventInput` com o `type`
 * comercial e `priority` (aceitos pela API). Estreitado p/ `CreateEventInput`
 * no `useCreateEvent` (assertion única, comentada no componente).
 */
export type QuickScheduleCreatePayload = Omit<CreateEventInput, 'type' | 'calendarId'> & {
  readonly type: QuickEventType;
  readonly priority: EventPriority;
  /**
   * Calendário opcional: o modal NÃO pede calendário — quando ausente, a API
   * (event-service) resolve o calendário pessoal do criador (provisiona se preciso).
   */
  readonly calendarId?: string;
  /**
   * Conversa de origem. A API (F53-S02) aceita e persiste, mas o `CreateEventInput`
   * de features/calendar ainda não expõe o campo — declaramos aqui e ele é enviado
   * no runtime (preservado no estreitamento p/ `CreateEventInput`).
   */
  readonly conversationId: string;
};

export interface QuickScheduleModalProps {
  /** Visível quando `true`. */
  readonly open: boolean;
  /** Contato pré-preenchido no evento. */
  readonly contactId: string;
  /** Conversa pré-preenchida no evento. */
  readonly conversationId: string;
  /** Fecha o modal (backdrop, Esc, Cancelar, sucesso). */
  onClose: () => void;
  /** Disparado após criar com sucesso (ex.: refetch da card de agenda — S04). */
  onCreated?: () => void;
}
