/**
 * Tom visual de cada TIPO de compromisso (maquete DS 3.0 "Unified calendar": a cor do
 * evento diz o que ele é, não de quem é). Só tokens: nenhuma cor literal.
 *
 * As classes são literais (e não montadas por interpolação) para o Tailwind enxergá-las.
 * O calendário de origem continua legível pelo pontinho de cor (`calendars.color`, dado
 * da API) e pela legenda da trilha.
 */

export type EventToneName = 'brand' | 'info' | 'warn' | 'violet' | 'neutral';

export interface EventTone {
  readonly name: EventToneName;
  /** Chip: tinta de 10% + barra de 3px à esquerda no tom. */
  readonly chip: string;
  /** Barra vertical sólida (timeline/lista). */
  readonly bar: string;
  /** Ícone/rótulo no tom (contraste ≥4,5:1 nos dois temas, tokens medidos na F72-S01). */
  readonly text: string;
}

const TONES: Readonly<Record<EventToneName, EventTone>> = {
  brand: {
    name: 'brand',
    chip: 'border-l-brand-text bg-brand-text/10',
    bar: 'bg-brand-text',
    text: 'text-brand-text',
  },
  info: {
    name: 'info',
    chip: 'border-l-info bg-info/10',
    bar: 'bg-info',
    text: 'text-info',
  },
  warn: {
    name: 'warn',
    chip: 'border-l-warn bg-warn/10',
    bar: 'bg-warn',
    text: 'text-warn',
  },
  violet: {
    name: 'violet',
    chip: 'border-l-violet bg-violet/10',
    bar: 'bg-violet',
    text: 'text-violet',
  },
  neutral: {
    name: 'neutral',
    chip: 'border-l-text-low bg-surface-3',
    bar: 'bg-text-low',
    text: 'text-text-mid',
  },
};

/** Tipo (EventType + tipos comerciais F53) → tom. Desconhecido cai em `neutral`. */
const TONE_BY_TYPE: Readonly<Record<string, EventToneName>> = {
  // Atendimento e relacionamento com o cliente.
  meeting: 'brand',
  call: 'brand',
  whatsapp: 'brand',
  // Apresentação / demonstração.
  demo: 'violet',
  // Acompanhamento e lembretes.
  follow_up: 'info',
  reminder: 'info',
  task: 'info',
  // Dinheiro e decisão pendente.
  billing: 'warn',
  proposal: 'warn',
  // Resto.
  other: 'neutral',
  custom: 'neutral',
};

export function eventTone(type: string): EventTone {
  return TONES[TONE_BY_TYPE[type] ?? 'neutral'];
}

/** Legenda dos tons (trilha do calendário): um item por tom, na ordem de leitura. */
export const EVENT_TONE_LEGEND: ReadonlyArray<{ readonly tone: EventTone; readonly label: string }> = [
  { tone: TONES.brand, label: 'Atendimento' },
  { tone: TONES.violet, label: 'Demonstração' },
  { tone: TONES.info, label: 'Follow-up e tarefa' },
  { tone: TONES.warn, label: 'Proposta e cobrança' },
  { tone: TONES.neutral, label: 'Outros' },
];
