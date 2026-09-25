/**
 * Contrato de entrada do eco do Instagram no worker (F70-S04).
 *
 * O eco chega normalizado por `parseInstagramEchoes` (`@hm/channels`,
 * `meta/instagram/echo.parser.ts`), mas cruza fronteira de processo (fila) antes
 * de chegar aqui — então é revalidado com Zod, como toda entrada externa. A forma
 * espelha `InstagramEchoEvent` campo a campo (o parser não é exportado pela raiz
 * de `@hm/channels` ainda — ver o relatório do slot).
 */
import { z } from 'zod';

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
