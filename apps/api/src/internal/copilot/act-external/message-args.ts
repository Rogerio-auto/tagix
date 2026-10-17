/**
 * `args` de `propose_send_messages` (capacidade `message.send`, F73-S09).
 *
 * `.strict()` em todos os níveis e sem campo de identidade (ADR-003 §3). Os destinatários vêm
 * de UMA de duas fontes, sempre re-resolvidas sob o escopo do membro:
 * - `contact_ids` (≤ 200): contatos que a pessoa já viu (ex.: pelo `search_contacts`);
 * - `filter`: a mesma régua das consultas `list_events` (compromissos de uma janela) ou
 *   `list_conversations` (conversas da inbox), para "quem tem avaliação amanhã".
 *
 * O conteúdo é texto livre com variáveis da allowlist (`render.ts`) OU um modelo aprovado do
 * catálogo da F58 (`template_id`) com os valores das variáveis do corpo (`{{1}}`, `{{2}}`…), que
 * também aceitam variáveis da allowlist. Placeholder fora da allowlist é `invalid_args`.
 */
import { z } from 'zod';
import { BATCH_LIMIT } from '@hm/shared';
import { EVENTS_WINDOW_MAX_DAYS } from '../read-ops/list-events';
import { scanPlaceholders } from './render';

/** Teto do texto (o WhatsApp aceita 4.096; a prévia mostra até 4.096). */
export const MESSAGE_TEXT_MAX = 4000;
/** Teto de cada valor de variável de modelo. */
export const TEMPLATE_VARIABLE_MAX = 200;
/** Variáveis de corpo de modelo aceitas. */
export const TEMPLATE_VARIABLES_MAX = 10;
const WAITING_MINUTES_MAX = 30 * 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const TextContentSchema = z
  .object({
    kind: z.literal('text'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(MESSAGE_TEXT_MAX)
      .describe(
        'Texto exato a enviar. Variáveis permitidas: {primeiro_nome}, {hora}, {data}, ' +
          '{procedimento} (do compromisso do destinatário). Nada mais entre chaves.',
      ),
  })
  .strict();

const TemplateContentSchema = z
  .object({
    kind: z.literal('template'),
    template_id: z.string().uuid().describe('Modelo aprovado do WhatsApp (catálogo de modelos).'),
    variables: z
      .array(z.string().trim().min(1).max(TEMPLATE_VARIABLE_MAX))
      .max(TEMPLATE_VARIABLES_MAX)
      .default([])
      .describe(
        'Valores de {{1}}, {{2}}… do corpo do modelo, em ordem. Aceitam as mesmas variáveis ' +
          'do texto ({primeiro_nome}, {hora}, {data}, {procedimento}).',
      ),
  })
  .strict();

export const MessageContentSchema = z.discriminatedUnion('kind', [
  TextContentSchema,
  TemplateContentSchema,
]);
export type MessageContentArgs = z.infer<typeof MessageContentSchema>;

const EventsFilterSchema = z
  .object({
    source: z.literal('events'),
    from: z.string().datetime({ offset: true }).describe('Início da janela (ISO 8601).'),
    to: z
      .string()
      .datetime({ offset: true })
      .describe(`Fim da janela (ISO 8601), até ${EVENTS_WINDOW_MAX_DAYS} dias.`),
    calendar_id: z.string().uuid().optional(),
  })
  .strict();

const ConversationsFilterSchema = z
  .object({
    source: z.literal('conversations'),
    status: z.enum(['waiting', 'open', 'resolved']).optional(),
    assigned: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
    channel: z.enum(['whatsapp', 'instagram']).optional(),
    waiting_minutes_gte: z.number().int().min(0).max(WAITING_MINUTES_MAX).optional(),
  })
  .strict();

export const RecipientFilterSchema = z.discriminatedUnion('source', [
  EventsFilterSchema,
  ConversationsFilterSchema,
]);
export type RecipientFilter = z.infer<typeof RecipientFilterSchema>;
export type EventsFilter = z.infer<typeof EventsFilterSchema>;
export type ConversationsFilter = z.infer<typeof ConversationsFilterSchema>;

function checkPlaceholders(text: string, path: (string | number)[], issue: z.RefinementCtx): void {
  const scan = scanPlaceholders(text);
  if (scan.unknown.length > 0) {
    issue.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Variável fora da lista: {${scan.unknown[0] ?? ''}}. Use {primeiro_nome}, {hora}, {data} ou {procedimento}.`,
    });
  }
  if (scan.unbalanced) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path, message: 'Chave sem par no texto.' });
  }
}

export const SendMessagesArgsSchema = z
  .object({
    contact_ids: z.array(z.string().uuid()).min(1).max(BATCH_LIMIT).optional(),
    filter: RecipientFilterSchema.optional(),
    content: MessageContentSchema,
    send_at: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        'Horário pedido para o envio. Agendamento de mensagem individual ainda não existe: ' +
          'a checagem avisa e a mensagem sai no confirmar.',
      ),
  })
  .strict()
  .superRefine((a, issue) => {
    if ((a.contact_ids === undefined) === (a.filter === undefined)) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact_ids'],
        message: 'Informe contact_ids OU filter (exatamente um).',
      });
    }
    if (a.filter?.source === 'events') {
      const from = Date.parse(a.filter.from);
      const to = Date.parse(a.filter.to);
      if (!(to > from) || to - from > EVENTS_WINDOW_MAX_DAYS * DAY_MS) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['filter', 'to'],
          message: `Janela inválida: 'to' depois de 'from', no máximo ${EVENTS_WINDOW_MAX_DAYS} dias.`,
        });
      }
    }
    if (a.content.kind === 'text') {
      checkPlaceholders(a.content.text, ['content', 'text'], issue);
    } else {
      a.content.variables.forEach((v, i) =>
        checkPlaceholders(v, ['content', 'variables', i], issue),
      );
    }
  });
export type SendMessagesArgs = z.infer<typeof SendMessagesArgsSchema>;
