/**
 * Handler `interactive` (FLOW_BUILDER.md secao 4.1). Envia interactive buttons/list.
 *
 * Shape rico (F31-S04): botoes podem ser de tipo `reply` (id+title), `url`
 * (title+url) ou `phone` (title+phoneNumber); listas tem `sections` com `rows` e
 * um `buttonLabel`. `body`/`header`/`footer` sao interpolados. O payload bruto e
 * repassado ao adapter do canal via `ctx.sendMessage.interactivePayload`.
 *
 * NOTA DE DEPENDENCIA (follow-up do bridge, F31-S01): o publisher outbound ainda
 * trata `interactivePayload` como no-op conservador — falta a traducao para o
 * `InteractivePayloadSchema` do `OutboundJob`. Logo, o envio e2e de interactive
 * pode nao chegar ao provider ate esse bridge existir. Este handler ja produz o
 * shape correto e validado; a integracao com o provider e responsabilidade do job.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

/**
 * Limites do provider (WhatsApp Cloud API). Espelhados no inspector
 * (`InteractiveInspector`) para validacao inline; mantidos aqui como defesa em
 * profundidade no dispatcher.
 */
export const INTERACTIVE_LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttonTitle: 20,
  buttonLabel: 20,
  replyButtonsMax: 3,
  sectionsMax: 10,
  rowsTotalMax: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
} as const;

const replyButtonSchema = z.object({
  type: z.literal('reply'),
  id: z.string().min(1),
  title: z.string().min(1).max(INTERACTIVE_LIMITS.buttonTitle),
});
const urlButtonSchema = z.object({
  type: z.literal('url'),
  title: z.string().min(1).max(INTERACTIVE_LIMITS.buttonTitle),
  url: z.string().url(),
});
const phoneButtonSchema = z.object({
  type: z.literal('phone'),
  title: z.string().min(1).max(INTERACTIVE_LIMITS.buttonTitle),
  phoneNumber: z.string().min(1),
});

/**
 * Botao interactive (discriminado por `type`). Sem `z.preprocess`/`default` para
 * manter input == output (exigencia do contrato `z.ZodType<T>` do FlowHandler). O
 * inspector sempre grava `type`; o dispatcher revalida via `schema.parse`.
 */
const buttonSchema = z.discriminatedUnion('type', [
  replyButtonSchema,
  urlButtonSchema,
  phoneButtonSchema,
]);

export type InteractiveButton = z.infer<typeof buttonSchema>;

const rowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(INTERACTIVE_LIMITS.rowTitle),
  description: z.string().max(INTERACTIVE_LIMITS.rowDescription).optional(),
});
const sectionSchema = z.object({
  title: z.string().max(INTERACTIVE_LIMITS.sectionTitle).optional(),
  rows: z.array(rowSchema).min(1),
});

const interactiveSchema = z
  .object({
    kind: z.enum(['buttons', 'list']),
    body: z.string().min(1).max(INTERACTIVE_LIMITS.body),
    header: z.string().max(INTERACTIVE_LIMITS.header).optional(),
    footer: z.string().max(INTERACTIVE_LIMITS.footer).optional(),
    buttons: z.array(buttonSchema).optional(),
    buttonLabel: z.string().max(INTERACTIVE_LIMITS.buttonLabel).optional(),
    sections: z.array(sectionSchema).max(INTERACTIVE_LIMITS.sectionsMax).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === 'buttons') {
      const buttons = data.buttons ?? [];
      if (buttons.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buttons'],
          message: 'Adicione ao menos um botao',
        });
      }
      const replyCount = buttons.filter((b) => b.type === 'reply').length;
      if (replyCount > INTERACTIVE_LIMITS.replyButtonsMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buttons'],
          message: `Maximo de ${INTERACTIVE_LIMITS.replyButtonsMax} botoes de resposta`,
        });
      }
    } else {
      const sections = data.sections ?? [];
      if (sections.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections'],
          message: 'Adicione ao menos uma secao com itens',
        });
      }
      const totalRows = sections.reduce((acc, s) => acc + s.rows.length, 0);
      if (totalRows > INTERACTIVE_LIMITS.rowsTotalMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections'],
          message: `Maximo de ${INTERACTIVE_LIMITS.rowsTotalMax} itens no total`,
        });
      }
    }
  });

export const interactiveHandler: FlowHandler<z.infer<typeof interactiveSchema>> = {
  schema: interactiveSchema,
  async execute(node, ctx) {
    const data = interactiveSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'interactive handler exige conversationId' };
    }

    const payload: Record<string, unknown> = {
      kind: data.kind,
      body: interpolate(data.body, ctx.variables),
      ...(data.header ? { header: interpolate(data.header, ctx.variables) } : {}),
      ...(data.footer ? { footer: interpolate(data.footer, ctx.variables) } : {}),
      ...(data.kind === 'buttons' && data.buttons ? { buttons: data.buttons } : {}),
      ...(data.kind === 'list' && data.buttonLabel ? { buttonLabel: data.buttonLabel } : {}),
      ...(data.kind === 'list' && data.sections ? { sections: data.sections } : {}),
    };

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      interactivePayload: payload,
    });

    return { status: 'SUCCESS' };
  },
};
