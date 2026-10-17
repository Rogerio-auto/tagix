/**
 * Contaminação do turno (ADR-004 §6; COPILOTO.md P4).
 *
 * Ferramenta que devolve texto escrito por contato (mensagens, notas, nome livre, campos de
 * texto, KB de terceiros) declara `taintsTurn: true`. O callback marca o turno ANTES de
 * devolver o resultado ao runtime, na mesma transação do handler: se a marca não grava, o
 * resultado não sai. A partir daí toda escrita do turno sobe para no mínimo o nível 3, e
 * quem sabe disso é o banco (`copilot_turns.tainted`), nunca o modelo.
 */
import { copilotTurnsRepo, type DbTx } from '@hm/db';

/**
 * Marca o turno como contaminado se a ferramenta lê conteúdo de contato. Idempotente.
 * Devolve `true` se o turno ficou (ou já estava) contaminado por esta chamada.
 */
export async function taintTurnIfNeeded(
  tx: DbTx,
  tool: { readonly taintsTurn: boolean },
  turnId: string,
): Promise<boolean> {
  if (!tool.taintsTurn) return false;
  return copilotTurnsRepo.markTainted(tx, turnId);
}
