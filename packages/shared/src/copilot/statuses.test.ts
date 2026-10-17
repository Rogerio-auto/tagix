/**
 * F73-S02 — enums de status do Copiloto.
 *
 * A igualdade com o banco (`@hm/db`, F73-S01) fica em `skip` até o S01 exportar os enums;
 * o F73-S03 liga o teste. O import é dinâmico para não criar dependência de compilação de
 * `@hm/shared` em `@hm/db` (o pacote é importado pelo navegador).
 */
import { describe, expect, it } from 'vitest';
import * as statuses from './statuses';
import {
  COPILOT_DB_ENUMS,
  COPILOT_HISTORY_RETENTION_MONTHS,
  COPILOT_PROPOSAL_OPEN_STATUSES,
  COPILOT_RISK_LEVELS,
  COPILOT_PROPOSAL_STATUSES,
  COPILOT_PROPOSAL_TERMINAL_STATUSES,
} from './statuses';

describe('enums de status', () => {
  it.each(Object.entries(COPILOT_DB_ENUMS))('%s não tem valor repetido nem vazio', (_nome, valores) => {
    const lista: readonly (string | number)[] = valores;
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista.length).toBeGreaterThan(0);
  });

  it('proposta: abertos e terminais são subconjuntos disjuntos do ciclo de vida (§6.3)', () => {
    const todos: readonly string[] = COPILOT_PROPOSAL_STATUSES;
    const abertos: readonly string[] = COPILOT_PROPOSAL_OPEN_STATUSES;
    const terminais: readonly string[] = COPILOT_PROPOSAL_TERMINAL_STATUSES;
    for (const s of [...abertos, ...terminais]) expect(todos).toContain(s);
    expect(abertos.filter((s) => terminais.includes(s))).toEqual([]);
  });

  it('risco e retenção são NÚMEROS, como no banco', () => {
    expect(COPILOT_RISK_LEVELS).toEqual([1, 2, 3, 4]);
    expect(COPILOT_HISTORY_RETENTION_MONTHS).toEqual([6, 12, 24]);
  });

  // TODO(F73-S03): ligar. O `@hm/db` (F73-S01, já integrado) exporta os enums com os MESMOS
  // nomes de constante e a MESMA ordem deste arquivo (conferido à mão na F73-S02). Fica em
  // `skip` porque `@hm/shared` não pode depender de `@hm/db` (circular: o db importa o
  // shared); o S03, que importa os dois, move/liga esta asserção. Compara valor E ordem.
  it.skip('são iguais aos `check` do banco (@hm/db)', async () => {
    const especificador = '@hm/db';
    const db = (await import(/* @vite-ignore */ especificador)) as unknown as Record<string, unknown>;
    const nomeDaConstante = new Map<unknown, string>(
      Object.entries(statuses).map(([nome, valor]) => [valor, nome]),
    );
    for (const [chave, nossos] of Object.entries(COPILOT_DB_ENUMS)) {
      const nome = nomeDaConstante.get(nossos);
      expect(nome, chave).toBeDefined();
      const doBanco = db[nome ?? ''];
      expect(Array.isArray(doBanco), `${chave} (${nome ?? '?'}) no @hm/db`).toBe(true);
      const valores: readonly unknown[] = Array.isArray(doBanco) ? doBanco : [];
      expect(valores, chave).toEqual([...nossos]);
    }
  });
});
