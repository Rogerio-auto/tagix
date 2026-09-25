/**
 * Contrato de entrada do eco do Instagram no worker (F70-S04).
 *
 * O eco chega normalizado por `parseInstagramEchoes` (`@hm/channels`) e é
 * revalidado com Zod, como toda entrada externa (a forma pode cruzar fronteira
 * de processo). O schema espelha `InstagramEchoEvent` campo a campo — a checagem
 * de tipo no fim do arquivo quebra o build se os dois divergirem.
 */
import { z } from 'zod';
import type { InstagramEchoEvent } from '@hm/channels';

export const instagramEchoSchema = z.object({
  provider: z.literal('meta_instagram'),
  igUserId: z.string().min(1),
  contactRemoteId: z.string().min(1),
  externalId: z.string().min(1),
  messageType: z.enum(['text', 'image', 'video', 'audio', 'document']),
  content: z.string().optional(),
  mediaRef: z.object({ refOrUrl: z.string().min(1) }).optional(),
  appId: z.string().min(1).optional(),
  rawTimestamp: z.string().min(1),
});

export type InstagramEchoInput = z.infer<typeof instagramEchoSchema>;

/** Compile-time: todo `InstagramEchoEvent` do parser é uma entrada válida aqui. */
const echoEventFitsInput: InstagramEchoEvent extends InstagramEchoInput ? true : false = true;
void echoEventFitsInput;
