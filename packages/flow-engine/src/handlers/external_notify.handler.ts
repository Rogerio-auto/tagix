/**
 * Handler `external_notify` (FLOW_BUILDER.md secao 4.3 — biestavel). Envia mensagem para
 * UMA OUTRA conversa (terceiro: responsavel, cliente externo, telefone custom) e,
 * opcionalmente, aguarda resposta (edges `response`/`timeout`, como wait_for_response).
 *
 * Resolucao do destino por `target`:
 *  - RESPONSIBLE     -> variables.responsible_phone
 *  - ENTITY_CUSTOMER -> variables.customer_phone
 *  - FLOW_CONTACT    -> phone do contato do flow (variables.contact.phone)
 *  - CUSTOM          -> config.customPhone
 *
 * A criacao/lookup de contact+conversation no `channelId` e responsabilidade do outbound
 * port (worker, F4-S03): aqui resolvemos o phone-alvo e publicamos com metadados de roteio.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowExecutionContext, FlowHandlerResult } from '../types';
import type { FlowHandler } from '../types';

const externalNotifySchema = z
  .object({
    target: z.enum(['RESPONSIBLE', 'ENTITY_CUSTOMER', 'FLOW_CONTACT', 'CUSTOM']),
    channelId: z.string().uuid(),
    customPhone: z.string().optional(),
    text: z.string().optional(),
    mediaUrl: z.string().optional(),
    mediaType: z.string().optional(),
    waitForResponse: z.boolean().optional(),
    timeoutMinutes: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    // Target CUSTOM exige um telefone livre (E.164). Os demais resolvem por variavel.
    if (data.target === 'CUSTOM' && !data.customPhone?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customPhone'],
        message: 'customPhone obrigatorio quando o destino e CUSTOM',
      });
    }
  });

function resolvePhone(
  ctx: FlowExecutionContext,
  data: z.infer<typeof externalNotifySchema>,
): string | undefined {
  const v = ctx.variables;
  switch (data.target) {
    case 'RESPONSIBLE':
      return typeof v['responsible_phone'] === 'string'
        ? (v['responsible_phone'] as string)
        : undefined;
    case 'ENTITY_CUSTOMER':
      return typeof v['customer_phone'] === 'string' ? (v['customer_phone'] as string) : undefined;
    case 'FLOW_CONTACT': {
      const contact = v['contact'];
      if (contact && typeof contact === 'object' && 'phone' in contact) {
        const phone = (contact as Record<string, unknown>)['phone'];
        return typeof phone === 'string' ? phone : undefined;
      }
      return undefined;
    }
    case 'CUSTOM':
      return data.customPhone;
  }
}

export const externalNotifyHandler: FlowHandler<z.infer<typeof externalNotifySchema>> = {
  schema: externalNotifySchema,
  async execute(node, ctx): Promise<FlowHandlerResult> {
    const data = externalNotifySchema.parse(node.data);
    const vars = ctx.variables;

    // Biestavel: resumption (respondeu).
    if (data.waitForResponse && vars['ext_notify_responded'] === true) {
      return {
        status: 'SUCCESS',
        edgeHandle: 'response',
        variables: { ext_notify_waiting: false, ext_notify_responded: false },
      };
    }

    // Biestavel: timeout (estava aguardando, timer venceu).
    if (data.waitForResponse && vars['ext_notify_waiting'] === true) {
      return {
        status: 'SUCCESS',
        edgeHandle: 'timeout',
        variables: { ext_notify_waiting: false },
      };
    }

    const phone = resolvePhone(ctx, data);
    if (!phone) {
      ctx.log('warn', `external_notify: phone do target ${data.target} indisponivel`, {
        target: data.target,
      });
      return { status: 'ERROR', error: `phone do target ${data.target} indisponivel` };
    }

    // Publica para a outra conversa: o outbound port resolve contact+conversation no canal.
    await ctx.sendMessage({
      conversationId: ctx.conversationId ?? '',
      text: data.text ? interpolate(data.text, vars) : undefined,
      mediaStorageKey: data.mediaUrl,
      mediaType: data.mediaType,
      interactivePayload: {
        kind: 'external_notify',
        targetPhone: phone,
        channelId: data.channelId,
      },
    });

    if (!data.waitForResponse) {
      return { status: 'SUCCESS' };
    }

    const nextStepAt = new Date(
      ctx.now().getTime() + (data.timeoutMinutes ?? 60) * 60_000,
    ).toISOString();
    return {
      status: 'WAITING',
      nextStepAt,
      variables: { ext_notify_waiting: true, ext_notify_started_at: ctx.now().toISOString() },
    };
  },
};
