/**
 * Validação Zod do envelope de callback (Python → Node).
 *
 * O corpo é serviço-a-serviço, mas NÃO confiamos cegamente: o `workspace_id`
 * vem do payload (não de sessão) e direciona o RLS — então é validado como UUID
 * antes de virar `set_config('app.workspace_id', …)`. `args` é um objeto opaco
 * (cada tool concreta o re-valida com seu próprio schema em F2-S20).
 */
import { z } from 'zod';

export const toolCallEnvelopeSchema = z.object({
  workspace_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullish(),
  agent_id: z.string().uuid(),
  execution_id: z.string().uuid(),
  args: z.record(z.string(), z.unknown()).default({}),
});

export type ToolCallEnvelopeInput = z.infer<typeof toolCallEnvelopeSchema>;
