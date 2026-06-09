import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Envelope padrão de toda mensagem na fila (validado em produção e consumo). */
export const envelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  workspaceId: z.string().uuid(),
  payload: z.unknown(),
  ts: z.number().int(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export function makeEnvelope(type: string, workspaceId: string, payload: unknown): Envelope {
  return { id: randomUUID(), type, workspaceId, payload, ts: Date.now() };
}
