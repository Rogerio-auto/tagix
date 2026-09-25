/**
 * Eco do Instagram no pipeline inbound (F70-S07, ligando o que a F70-S04 deixou pronto).
 *
 * O webhook do Instagram chega inteiro ao `hm.q.inbound`. `parseInstagramWebhook`
 * descarta os itens `is_echo` de propósito (eco não é mensagem recebida); este
 * passo os recolhe do MESMO payload com `parseInstagramEchoes` e entrega ao núcleo
 * de ecos da coexistência (`handleInstagramEchoes` → `persistInstagramEcho`): o que
 * o dono respondeu pelo app vira mensagem `member` e pausa a IA, exatamente como o
 * eco do WhatsApp Business.
 *
 * Por que aqui e não na borda do webhook: a borda já deduplica e publica o payload
 * cru; reaproveitar esse envelope evita uma segunda fila e mantém a borda magra.
 */
import { parseInstagramEchoes } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { handleInstagramEchoes } from '../coexistence/worker';
import type { CoexistenceDeps } from '../coexistence/ports';

/** Passo de ecos do Instagram (injetável no pipeline). */
export interface InstagramEchoPort {
  /** Processa os ecos do payload cru. Retorna quantos ecos encontrou. */
  handle(raw: unknown, logger: Logger): Promise<number>;
}

export function createInstagramEchoStep(coexistence: CoexistenceDeps): InstagramEchoPort {
  return {
    async handle(raw, logger) {
      const echoes = parseInstagramEchoes(raw);
      if (echoes.length === 0) return 0;
      await handleInstagramEchoes(echoes, { deps: coexistence, logger });
      return echoes.length;
    },
  };
}
