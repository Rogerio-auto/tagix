/**
 * Download de midia de story IG (INSTAGRAM.md 8, 17). A URL temporaria do story
 * expira em ~5min, por isso o worker inbound enfileira o download em alta
 * prioridade. Aqui so a mecanica de baixar o binario via GraphClient.
 */

import type { GraphClient } from '../../shared/graphClient';

/**
 * Baixa o binario de uma URL temporaria de story. A URL ja vem pronta no
 * payload do webhook (attachment.payload.url). Bearer e opcional: URLs
 * lookaside da Meta normalmente servem direto.
 */
export async function downloadStoryMedia(
  graph: GraphClient,
  temporaryUrl: string,
  accessToken?: string,
): Promise<Buffer> {
  return graph.downloadBinary(temporaryUrl, accessToken);
}
