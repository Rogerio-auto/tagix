/**
 * Classificador de risco do Copiloto (COPILOTO.md §6.1, ADR-004 §1).
 *
 * O nível é do SISTEMA, nunca do modelo: o modelo é justamente o que um texto de cliente
 * consegue manipular. Toda entrada é calculada pelo Node (alvos resolvidos sob escopo,
 * efeito externo, reversibilidade, aviso a membros e contaminação do turno, que vem do
 * banco). Função pura, testada por tabela, importável por API e navegador.
 *
 * Regra (§6.1):
 *
 *   se capability é consulta                       → 1
 *   teto: target_count > BATCH_LIMIT (200)         → recusa ("use a tela")
 *   se external ou irreversible                    → 4
 *   nível = base(capability)                       // 2 para escrita reversível
 *   se target_count ≥ 2 ou notifies_members        → max(nível, 3)
 *   se turn_tainted                                → max(nível, 3)   // P4
 *
 * Decisões de leitura da spec:
 * - O teto vale para TODA escrita e é checado antes do nível 4. Lido em ordem literal, um
 *   envio externo a 5.000 contatos sairia como nível 4 em vez de recusado; o teto existe
 *   justamente para mandar lote grande para a tela, onde há segmentação e prévia própria.
 * - `external` e `irreversible` do catálogo somam-se aos da entrada (OU). Assim
 *   `message.send` é externo mesmo que o chamador esqueça a flag; e `deal.move`, estático
 *   `false`, vira externo quando o executor detecta automação de estágio.
 * - `reasons` lista todas as regras que dispararam, na ordem acima, para a prévia explicar
 *   o nível ("Nível 4 · fala com clientes · em lote").
 */
import { CAPABILITIES, type CapabilityKey } from './capabilities';

/** Lote máximo por proposta. Acima disso o Copiloto recusa e aponta a tela (invalid_args). */
export const BATCH_LIMIT = 200;

export const RISK_LEVELS = [1, 2, 3, 4] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_REASONS = [
  /** Consulta: nível 1, executa na hora. */
  'query',
  /** Escrita: nível base do catálogo. */
  'write',
  /** Capacidade com base 4 no catálogo (externa ou irreversível por natureza). */
  'high_risk_capability',
  /** Fala com quem está fora da empresa. */
  'external',
  /** Não tem volta. */
  'irreversible',
  /** Mais de um alvo. */
  'batch',
  /** Avisa membros da equipe. */
  'notifies_members',
  /** O turno leu conteúdo escrito por contato (P4). */
  'tainted',
] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

export interface RiskInput {
  readonly capability: CapabilityKey;
  /** Alvos resolvidos sob o escopo do membro (inteiro ≥ 0). */
  readonly target_count: number;
  readonly external: boolean;
  readonly irreversible: boolean;
  readonly notifies_members: boolean;
  readonly turn_tainted: boolean;
}

export type RiskClassification =
  | { readonly level: RiskLevel; readonly reasons: readonly RiskReason[] }
  | { readonly refused: 'batch_too_large' };

/** Type guard para o ramo recusado. */
export function isRiskRefused(
  r: RiskClassification,
): r is { readonly refused: 'batch_too_large' } {
  return 'refused' in r;
}

export function classifyRisk(input: RiskInput): RiskClassification {
  const { target_count: n } = input;
  // Erro de programação do chamador, não dado do modelo: falha alto em vez de classificar
  // um número sem sentido (NaN passaria por todas as comparações como "pequeno").
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`classifyRisk: target_count inválido (${String(n)})`);
  }

  const def = CAPABILITIES[input.capability];
  if (def.kind === 'query') return { level: 1, reasons: ['query'] };

  if (n > BATCH_LIMIT) return { refused: 'batch_too_large' };

  const reasons: RiskReason[] = ['write'];
  let level: RiskLevel = def.baseRisk === 4 ? 4 : 2;
  if (def.baseRisk === 4) reasons.push('high_risk_capability');

  const external = input.external || def.external;
  const irreversible = input.irreversible || def.irreversible;
  if (external) reasons.push('external');
  if (irreversible) reasons.push('irreversible');
  if (external || irreversible) level = 4;

  if (n >= 2) reasons.push('batch');
  if (input.notifies_members) reasons.push('notifies_members');
  if (n >= 2 || input.notifies_members) level = level === 4 ? 4 : 3;

  if (input.turn_tainted) {
    reasons.push('tainted');
    level = level === 4 ? 4 : 3;
  }

  return { level, reasons };
}
