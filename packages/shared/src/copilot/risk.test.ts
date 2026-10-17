/**
 * F73-S02 — classificador de risco por tabela (COPILOTO.md §6.1, ADR-004 §1).
 *
 * O que este arquivo protege: que o nível de uma ação seja do SISTEMA. Cobre todas as
 * combinações de `external`, `irreversible`, `notifies_members`, `turn_tainted` e
 * `target_count ∈ {1, 2, 200, 201}` para cada capacidade do catálogo (13 × 64 = 832
 * casos), contra um oráculo escrito na forma literal da spec, mais uma tabela de casos
 * escritos à mão que não dependem do oráculo.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey } from './capabilities';
import {
  BATCH_LIMIT,
  classifyRisk,
  isRiskRefused,
  type RiskClassification,
  type RiskInput,
  type RiskLevel,
} from './risk';

const COUNTS = [1, 2, 200, 201] as const;
const BOOLS = [false, true] as const;

/** A regra da spec, escrita de novo e de forma independente da implementação. */
function oracle(i: RiskInput): RiskLevel | 'refused' {
  const def = CAPABILITIES[i.capability];
  if (def.kind === 'query') return 1;
  if (i.target_count > 200) return 'refused';
  if (i.external || i.irreversible || def.external || def.irreversible) return 4;
  let nivel: number = def.baseRisk;
  if (i.target_count >= 2 || i.notifies_members) nivel = Math.max(nivel, 3);
  if (i.turn_tainted) nivel = Math.max(nivel, 3);
  return nivel as RiskLevel;
}

function levelOf(r: RiskClassification): RiskLevel | 'refused' {
  return isRiskRefused(r) ? 'refused' : r.level;
}

const casos: RiskInput[] = [];
for (const capability of CAPABILITY_KEYS) {
  for (const target_count of COUNTS) {
    for (const external of BOOLS) {
      for (const irreversible of BOOLS) {
        for (const notifies_members of BOOLS) {
          for (const turn_tainted of BOOLS) {
            casos.push({ capability, target_count, external, irreversible, notifies_members, turn_tainted });
          }
        }
      }
    }
  }
}

describe('classifyRisk — todas as combinações, por capacidade', () => {
  it('cobre 13 capacidades × 4 volumes × 16 combinações de flags', () => {
    expect(casos).toHaveLength(CAPABILITY_KEYS.length * COUNTS.length * 16);
  });

  for (const capability of CAPABILITY_KEYS) {
    describe(capability, () => {
      it.each(casos.filter((c) => c.capability === capability))(
        'n=$target_count ext=$external irr=$irreversible notif=$notifies_members taint=$turn_tainted',
        (c) => {
          expect(levelOf(classifyRisk(c))).toBe(oracle(c));
        },
      );
    });
  }
});

/** Tabela escrita à mão: não usa o oráculo. */
const flags = { external: false, irreversible: false, notifies_members: false, turn_tainted: false };
const tabela: ReadonlyArray<[string, RiskInput, RiskLevel | 'refused']> = [
  ['consulta é 1, mesmo com tudo ligado', { capability: 'query', target_count: 201, external: true, irreversible: true, notifies_members: true, turn_tainted: true }, 1],
  ['tag em 1 contato: 2', { capability: 'contact.tag', target_count: 1, ...flags }, 2],
  ['tag em 2 contatos: 3 (lote)', { capability: 'contact.tag', target_count: 2, ...flags }, 3],
  ['tag em 200 contatos: 3 (no limite)', { capability: 'contact.tag', target_count: 200, ...flags }, 3],
  ['tag em 201 contatos: recusa', { capability: 'contact.tag', target_count: 201, ...flags }, 'refused'],
  ['editar 1 contato: 2', { capability: 'contact.update', target_count: 1, ...flags }, 2],
  ['trocar responsável avisando membros: 3', { capability: 'deal.assign_owner', target_count: 1, ...flags, notifies_members: true }, 3],
  ['mover 1 negócio: 2', { capability: 'deal.move', target_count: 1, ...flags }, 2],
  ['mover 7 negócios: 3', { capability: 'deal.move', target_count: 7, ...flags }, 3],
  ['mover com automação que fala com o cliente: 4', { capability: 'deal.move', target_count: 1, ...flags, external: true }, 4],
  ['mover 201 com automação: recusa (o teto vem antes do 4)', { capability: 'deal.move', target_count: 201, ...flags, external: true }, 'refused'],
  ['nota em turno contaminado: 3 (P4)', { capability: 'conversation.note', target_count: 1, ...flags, turn_tainted: true }, 3],
  ['compromisso interno: 2', { capability: 'event.create_internal', target_count: 1, ...flags }, 2],
  ['ensinar fato: 2', { capability: 'memory.remember', target_count: 0, ...flags }, 2],
  ['ensinar fato em turno contaminado: 3 (R11)', { capability: 'memory.remember', target_count: 0, ...flags, turn_tainted: true }, 3],
  ['mensagem a 1 contato: 4, mesmo sem flag do chamador', { capability: 'message.send', target_count: 1, ...flags }, 4],
  ['lembrete a 12 pacientes: 4', { capability: 'message.send', target_count: 12, ...flags }, 4],
  ['pausar campanha: 4', { capability: 'campaign.pause', target_count: 1, ...flags }, 4],
  ['retomar campanha: 4', { capability: 'campaign.resume', target_count: 1, ...flags }, 4],
  ['cancelar campanha: 4', { capability: 'campaign.cancel', target_count: 1, ...flags }, 4],
  ['disparar flow para 3: 4', { capability: 'flow.trigger', target_count: 3, ...flags }, 4],
  ['disparar flow para 201: recusa', { capability: 'flow.trigger', target_count: 201, ...flags }, 'refused'],
];

describe('classifyRisk — tabela da maquete (A5)', () => {
  it.each(tabela)('%s', (_nome, input, esperado) => {
    expect(levelOf(classifyRisk(input))).toBe(esperado);
  });
});

describe('classifyRisk — invariantes', () => {
  it('BATCH_LIMIT é 200', () => {
    expect(BATCH_LIMIT).toBe(200);
  });

  it('escrita nunca fica abaixo da base do catálogo', () => {
    for (const c of casos) {
      const r = classifyRisk(c);
      if (!isRiskRefused(r)) expect(r.level).toBeGreaterThanOrEqual(CAPABILITIES[c.capability].baseRisk);
    }
  });

  it('turno contaminado: toda escrita é no mínimo 3', () => {
    for (const c of casos.filter((x) => x.turn_tainted && x.capability !== 'query')) {
      const r = classifyRisk(c);
      if (!isRiskRefused(r)) expect(r.level).toBeGreaterThanOrEqual(3);
    }
  });

  it('nível 2 só acontece com 1 alvo, sem aviso, sem contaminação e sem efeito externo', () => {
    for (const c of casos) {
      const r = classifyRisk(c);
      if (!isRiskRefused(r) && r.level === 2) {
        expect(c.target_count).toBeLessThan(2);
        expect(c.notifies_members || c.turn_tainted || c.external || c.irreversible).toBe(false);
      }
    }
  });

  it('só escrita é recusada, e só acima do limite', () => {
    for (const c of casos) {
      const recusada = isRiskRefused(classifyRisk(c));
      expect(recusada).toBe(c.capability !== 'query' && c.target_count > BATCH_LIMIT);
    }
  });

  it('reasons explicam o nível, na ordem das regras', () => {
    const r = classifyRisk({
      capability: 'deal.move',
      target_count: 7,
      external: true,
      irreversible: false,
      notifies_members: true,
      turn_tainted: true,
    });
    expect(r).toEqual({ level: 4, reasons: ['write', 'external', 'batch', 'notifies_members', 'tainted'] });
    expect(classifyRisk({ capability: 'campaign.cancel', target_count: 1, ...flags })).toEqual({
      level: 4,
      reasons: ['write', 'high_risk_capability', 'external', 'irreversible'],
    });
    expect(classifyRisk({ capability: 'query', target_count: 1, ...flags })).toEqual({
      level: 1,
      reasons: ['query'],
    });
  });

  it('é determinístico: a mesma entrada dá a mesma saída', () => {
    for (const c of casos.slice(0, 64)) expect(classifyRisk(c)).toEqual(classifyRisk({ ...c }));
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('target_count inválido (%s) lança', (n) => {
    expect(() => classifyRisk({ capability: 'contact.tag' as CapabilityKey, target_count: n, ...flags })).toThrow(
      RangeError,
    );
  });
});
