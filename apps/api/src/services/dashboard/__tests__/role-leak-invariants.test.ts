/**
 * F55-S09 (QA) — invariantes de NÃO-VAZAMENTO por role, varridas mecanicamente sobre o
 * registry inteiro. Diferente do teste de card-set exato (load-dashboard.test.ts, que
 * trava a composição atual byte a byte), aqui afirmamos PROPRIEDADES estruturais que têm
 * de valer para QUALQUER card futuro — uma defesa que pega o erro antes do humano:
 *
 *  1. AGENT nunca enxerga dado sensível de negócio/custo (custo IA, ROI, Placar, Funil,
 *     receita do workspace, ops de IA caras). É a regra de ouro do §8 (PERMISSIONS).
 *  2. Custo de IA (`roi_ia` + `custo_llm_*`) é classe ADMIN+: nem AGENT nem SUPERVISOR.
 *  3. READONLY é informativo e SUBCONJUNTO do que o OWNER vê — nunca enxerga algo que o
 *     OWNER não enxergue (não pode "ver mais que o dono").
 *  4. OWNER é o teto dos cards de WORKSPACE/EQUIPE: todo card NÃO-pessoal visível a ADMIN
 *     também é visível ao OWNER (hierarquia aditiva §1). Cards `scope:'personal'` são a
 *     exceção deliberada — "resolvidas por mim" não vai pro dono, que não atende; por
 *     isso a invariante restringe a `scope !== 'personal'`.
 *  5. Toda categoria `negocio` é vedada ao AGENT (a aba inteira é de dono/supervisão).
 *
 * Puro (sem DB) — opera só sobre as definições declarativas. Roda em qualquer ambiente.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from '@hm/shared';
import { METRIC_DEFINITIONS, visibleMetricKeys } from '../metrics/registry';

const set = (role: Role): Set<string> => new Set(visibleMetricKeys(role));

/** Cards que carregam custo/receita/estratégia de negócio — jamais para o AGENT. */
const SENSITIVE_FOR_AGENT: readonly string[] = [
  'custo_llm_hoje_usd',
  'custo_llm_mes_usd',
  'roi_ia',
  'placar_ia_humano',
  'funil_pipeline',
  'conversoes_workspace_mes',
  'valor_convertido_workspace_mes',
  'novos_contatos_mes',
  'contatos_total_workspace',
  'latencia_agente_p95_24h',
  'tokens_por_modelo_24h',
  'cap_mensal_consumido_pct',
];

/** Custo de IA: classe ADMIN+ (mesma sensibilidade do §2.4). */
const AI_COST_KEYS: readonly string[] = ['roi_ia', 'custo_llm_hoje_usd', 'custo_llm_mes_usd'];

describe('F55 role-leak invariants (varredura mecânica do registry)', () => {
  it('AGENT não enxerga nenhum card sensível de negócio/custo', () => {
    const agent = set('AGENT');
    for (const key of SENSITIVE_FOR_AGENT) {
      expect(agent.has(key), `AGENT vazou ${key}`).toBe(false);
    }
  });

  it('custo de IA (ROI + custo LLM) é vedado a AGENT e SUPERVISOR', () => {
    const agent = set('AGENT');
    const sup = set('SUPERVISOR');
    for (const key of AI_COST_KEYS) {
      expect(agent.has(key), `AGENT vê custo IA ${key}`).toBe(false);
      expect(sup.has(key), `SUPERVISOR vê custo IA ${key}`).toBe(false);
    }
  });

  it('nenhum card da categoria "negocio" é visível ao AGENT', () => {
    const agent = set('AGENT');
    const negocioKeys = METRIC_DEFINITIONS.filter((m) => m.category === 'negocio').map((m) => m.key);
    // Sanidade: a categoria existe e contém os cards novos.
    expect(negocioKeys).toEqual(
      expect.arrayContaining(['placar_ia_humano', 'roi_ia', 'funil_pipeline']),
    );
    for (const key of negocioKeys) {
      expect(agent.has(key), `AGENT vê negocio ${key}`).toBe(false);
    }
  });

  it('READONLY é subconjunto estrito do que o OWNER vê (informativo, nunca além do dono)', () => {
    const owner = set('OWNER');
    for (const key of visibleMetricKeys('READONLY')) {
      expect(owner.has(key), `READONLY vê ${key} que o OWNER não vê`).toBe(true);
    }
  });

  it('OWNER é o teto dos cards não-pessoais: ADMIN ⊆ OWNER fora de scope:personal (§1)', () => {
    const owner = set('OWNER');
    const personal = new Set(
      METRIC_DEFINITIONS.filter((m) => m.scope === 'personal').map((m) => m.key),
    );
    for (const key of visibleMetricKeys('ADMIN')) {
      if (personal.has(key)) continue; // exceção deliberada (ex.: resolvidas_hoje_por_mim)
      expect(owner.has(key), `card não-pessoal ${key} visível ao ADMIN mas não ao OWNER`).toBe(
        true,
      );
    }
  });

  it('a única assimetria ADMIN-sem-OWNER é de scope:personal (documenta o quirk)', () => {
    const owner = set('OWNER');
    const adminOnly = visibleMetricKeys('ADMIN').filter((k) => !owner.has(k));
    const byKey = new Map(METRIC_DEFINITIONS.map((m) => [m.key, m]));
    for (const key of adminOnly) {
      expect(byKey.get(key)?.scope, `${key} é ADMIN-only mas não é pessoal`).toBe('personal');
    }
  });

  it('toda definição declara ao menos um role (nenhum card órfão/invisível)', () => {
    for (const m of METRIC_DEFINITIONS) {
      expect(m.roles.length, `card ${m.key} sem roles`).toBeGreaterThan(0);
    }
  });
});
