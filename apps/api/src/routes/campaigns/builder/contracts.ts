/**
 * Contratos Zod do criador guiado de campanhas (F58-S06 / CAMPAIGNS.md §2, §4).
 *
 * Este módulo é a fronteira entre a linguagem do produto e o domínio técnico:
 * a interface fala `single`/`sequence` e o banco continua guardando
 * `broadcast`/`drip`. `triggered` não tem nome de produto e é recusado com
 * explicação enquanto não houver runtime próprio (CAMPAIGNS.md §1).
 *
 * O contrato de bindings (`binding_contract/v1`) é o que permite ao runtime
 * (F58-S12) renderizar cada variável POR DESTINATÁRIO em vez de gravar um texto
 * já resolvido — por isso ele é persistido, versionado e validado aqui.
 */
import { z } from 'zod';

export const publicCampaignModeSchema = z.enum(['single', 'sequence']);
export type PublicCampaignMode = z.infer<typeof publicCampaignModeSchema>;

export function toStoredCampaignType(mode: PublicCampaignMode): 'broadcast' | 'drip' {
  return mode === 'single' ? 'broadcast' : 'drip';
}

export function toPublicCampaignMode(type: string): PublicCampaignMode | null {
  if (type === 'broadcast') return 'single';
  if (type === 'drip') return 'sequence';
  return null;
}

/**
 * Fallback é OBRIGATÓRIO e não-vazio para toda origem dinâmica: um contato sem o
 * campo preenchido não pode virar uma mensagem com buraco no meio da frase.
 */
const fallbackSchema = z.string().trim().min(1).max(1_000);

export const bindingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), value: z.string().trim().min(1).max(1_000) }).strict(),
  z
    .object({
      kind: z.literal('contact'),
      field: z.enum(['displayName', 'phone', 'email']),
      fallback: fallbackSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('customField'),
      key: z.string().trim().min(1).max(120),
      fallback: fallbackSchema,
    })
    .strict(),
]);

export type BindingSource = z.infer<typeof bindingSourceSchema>;

export const templateBindingSchema = z
  .object({
    component: z.enum(['header', 'body', 'button']),
    index: z.number().int().min(1).max(100),
    source: bindingSourceSchema,
  })
  .strict();

export const templateBindingsSchema = z
  .array(templateBindingSchema)
  .max(100)
  .superRefine((bindings, ctx) => {
    const seen = new Set<string>();
    bindings.forEach((binding, index) => {
      const key = `${binding.component}:${binding.index}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `A variável ${key} foi configurada mais de uma vez.`,
        });
      }
      seen.add(key);
    });
  });

export type TemplateBinding = z.infer<typeof templateBindingSchema>;

/** Envelope persistido em `campaign_steps.template_components`. */
export const BINDING_CONTRACT_TYPE = 'binding_contract' as const;
export const BINDING_CONTRACT_VERSION = 1 as const;

export interface PersistedBindingsContract {
  readonly type: typeof BINDING_CONTRACT_TYPE;
  readonly version: typeof BINDING_CONTRACT_VERSION;
  readonly bindings: readonly TemplateBinding[];
}

/**
 * O envelope ocupa a posição 0 do array já existente para não exigir mudança de
 * schema neste slot. Quem lê precisa distinguir o envelope de um componente
 * Graph legado — `decodeBindings` é a única porta de entrada.
 */
export function encodeBindings(
  bindings: readonly TemplateBinding[],
): Array<Record<string, unknown>> {
  return [{ type: BINDING_CONTRACT_TYPE, version: BINDING_CONTRACT_VERSION, bindings }];
}

export function decodeBindings(value: unknown): readonly TemplateBinding[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const envelope: unknown = value[0];
  if (typeof envelope !== 'object' || envelope === null) return null;
  const record = envelope as Record<string, unknown>;
  if (record['type'] !== BINDING_CONTRACT_TYPE) return null;
  if (record['version'] !== BINDING_CONTRACT_VERSION) return null;
  const parsed = templateBindingsSchema.safeParse(record['bindings']);
  return parsed.success ? parsed.data : null;
}

/** `true` quando o valor persistido é o envelope de bindings (e não componentes Graph). */
export function isBindingContract(value: unknown): boolean {
  return decodeBindings(value) !== null;
}

export const optionsQuerySchema = z
  .object({
    channelId: z.string().uuid().optional(),
    search: z.string().trim().max(120).optional(),
    category: z.string().trim().max(80).optional(),
    language: z.string().trim().max(40).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const previewSchema = z
  .object({
    templateId: z.string().uuid(),
    bindings: templateBindingsSchema,
    sampleContactId: z.string().uuid().optional(),
  })
  .strict();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Use o formato HH:MM.');

export const sendWindowsOverrideSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.string().trim().min(1).max(80).optional(),
    windows: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            start: timeSchema,
            end: timeSchema,
          })
          .strict()
          .refine((w) => w.start < w.end, {
            message: 'O horário final precisa ser depois do inicial.',
          }),
      )
      .max(60)
      .optional(),
  })
  .strict();

/**
 * A etapa "Quando enviar" precisa reagir ANTES de salvar o rascunho: os campos
 * abaixo sobrepõem o que está persistido só para o cálculo desta resposta.
 */
export const deliveryOverridesSchema = z
  .object({
    ratePerMinute: z.number().int().min(1).max(600).optional(),
    dailyLimit: z.number().int().min(1).max(1_000_000).nullish(),
    sendWindows: sendWindowsOverrideSchema.optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    startAt: z.string().datetime().nullish(),
  })
  .strict();

export type DeliveryOverrides = z.infer<typeof deliveryOverridesSchema>;

export const estimateSchema = deliveryOverridesSchema.default({});
export const preflightSchema = deliveryOverridesSchema.default({});

export const testSendSchema = z
  .object({
    templateId: z.string().uuid(),
    to: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/u, 'Informe o telefone no formato +5511999999999.'),
    bindings: templateBindingsSchema,
    sampleContactId: z.string().uuid().optional(),
  })
  .strict();

export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

export function parseRequiredIdempotencyKey(raw: string | string[] | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH ? value : null;
}

/**
 * Acima deste público um disparo sem qualidade/capacidade conhecidas do provider
 * é bloqueado: é o volume em que um erro de reputação deixa de ser recuperável.
 */
export const LARGE_SEND_THRESHOLD = 1_000;
