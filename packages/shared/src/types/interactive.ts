/**
 * Payload interativo de mensagens (LIVECHAT.md §4.1). No DB é jsonb; aqui é
 * TIPADO via discriminated union Zod (resolve o FX-023d do v1). Validar no boundary.
 */
import { z } from 'zod';

export const InteractiveButtonsSchema = z.object({
  type: z.literal('buttons'),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  buttons: z.array(z.object({ id: z.string(), text: z.string() })).min(1).max(3),
});

export const InteractiveListSchema = z.object({
  type: z.literal('list'),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  button: z.string(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        rows: z.array(
          z.object({ id: z.string(), title: z.string(), description: z.string().optional() }),
        ),
      }),
    )
    .min(1),
});

export const InteractiveTemplateSchema = z.object({
  type: z.literal('template'),
  name: z.string(),
  languageCode: z.string(),
  components: z.array(z.unknown()),
});

export const InteractivePayloadSchema = z.discriminatedUnion('type', [
  InteractiveButtonsSchema,
  InteractiveListSchema,
  InteractiveTemplateSchema,
]);

export type InteractivePayload = z.infer<typeof InteractivePayloadSchema>;
