/**
 * Handler `template` (F31-S10, bridge fechada em F33-S02). Envia um template/HSM
 * aprovado (WhatsApp Business), que reabre a janela de 24h. Carrega `templateName`
 * + `languageCode` + parametros por componente (header/body/button), todos
 * interpolados com as variaveis da execucao.
 *
 * DESIGN: monta o payload de template no shape interno
 * `{ kind:'template', template:{ name, language:{ code }, components } }` e
 * envia via `ctx.sendMessage({ interactivePayload })`. O `outbound-publisher` do
 * worker detecta `kind === 'template'`, extrai os campos e publica
 * `OutboundJob { kind:'template', templateName, languageCode, components }`.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const COMPONENTS = ['header', 'body', 'button'] as const;
type ComponentType = (typeof COMPONENTS)[number];

const templateParamSchema = z.object({
  /** Componente alvo do parametro. */
  component: z.enum(COMPONENTS).optional(),
  /** Valor do parametro (texto cru — interpolado no envio). */
  text: z.string(),
});

const templateSchema = z.object({
  /** Nome do template aprovado na Meta. */
  templateName: z.string().min(1),
  /** Codigo de idioma do template (ex.: `pt_BR`, `en_US`). */
  languageCode: z.string().min(2),
  /** Parametros posicionais por componente (interpolados). */
  params: z.array(templateParamSchema).optional(),
});

type TemplateData = z.infer<typeof templateSchema>;

/** Parametro do componente no shape Cloud API. */
interface TemplateParameter {
  readonly type: 'text';
  readonly text: string;
}

/** Componente do template no shape Cloud API. */
interface TemplateComponent {
  readonly type: ComponentType;
  readonly parameters: TemplateParameter[];
}

/**
 * Agrupa os parametros por componente, interpolando cada valor, e devolve os
 * componentes no shape `{ type, parameters }` esperado pelo Cloud API.
 */
function buildComponents(
  params: TemplateData['params'],
  variables: Record<string, unknown>,
): TemplateComponent[] {
  if (!params || params.length === 0) return [];
  const byComponent = new Map<ComponentType, TemplateParameter[]>();
  for (const param of params) {
    const component: ComponentType = param.component ?? 'body';
    const list = byComponent.get(component) ?? [];
    list.push({ type: 'text', text: interpolate(param.text, variables) });
    byComponent.set(component, list);
  }
  return Array.from(byComponent, ([type, parameters]) => ({ type, parameters }));
}

export const templateHandler: FlowHandler<TemplateData> = {
  schema: templateSchema,
  async execute(node, ctx) {
    const data = templateSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'template handler exige conversationId' };
    }

    const templatePayload = {
      kind: 'template' as const,
      template: {
        name: data.templateName,
        language: { code: data.languageCode },
        components: buildComponents(data.params, ctx.variables),
      },
    };

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      interactivePayload: templatePayload,
    });

    ctx.log('info', 'template: HSM enfileirado', {
      templateName: data.templateName,
      languageCode: data.languageCode,
    });
    return { status: 'SUCCESS' };
  },
};
