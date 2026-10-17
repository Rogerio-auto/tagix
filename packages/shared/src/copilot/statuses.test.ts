/**
 * F73-S02 — enums de status do Copiloto; F73-S03 liga a igualdade com o banco.
 *
 * A igualdade com o `@hm/db` (F73-S01) importa o schema do db por CAMINHO RELATIVO
 * (`packages/db/src/schema/copilot.ts`), só neste teste: `@hm/shared` não pode depender de
 * `@hm/db` (circular: o db importa o shared, e o shared vai para o navegador). O arquivo de
 * schema resolve as próprias dependências (`drizzle-orm`) a partir de `packages/db`.
 *
 * O carregamento é por `import.meta.glob` (resolvido pelo Vite em tempo de teste): o `tsc`
 * do `@hm/shared` (rootDir `src`) não segue o padrão do glob, então o código do db não entra
 * no programa dele, e o Vitest carrega o arquivo pelo mesmo caminho de um import estático.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as statuses from './statuses';
import {
  COPILOT_DB_ENUMS,
  COPILOT_HISTORY_RETENTION_MONTHS,
  COPILOT_PROPOSAL_OPEN_STATUSES,
  COPILOT_RISK_LEVELS,
  COPILOT_PROPOSAL_STATUSES,
  COPILOT_PROPOSAL_TERMINAL_STATUSES,
} from './statuses';

type ModuleRecord = Readonly<Record<string, unknown>>;

declare global {
  interface ImportMeta {
    /** Vite (Vitest): o `@hm/shared` não carrega os tipos de `vite/client`. */
    glob<T>(pattern: string): Record<string, () => Promise<T>>;
  }
}

/** `packages/db/src/schema/copilot.ts`, carregado em tempo de teste. */
let dbCopilot: ModuleRecord = {};

beforeAll(async () => {
  const loaders = import.meta.glob<ModuleRecord>('../../../db/src/schema/copilot.ts');
  const [load] = Object.values(loaders);
  if (!load) throw new Error('schema do Copiloto no @hm/db não encontrado');
  dbCopilot = await load();
});

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

  it('são iguais aos `check` do banco (@hm/db): mesmo nome de constante, valor e ordem', () => {
    const db = dbCopilot;
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

  it('nenhum enum `COPILOT_*` do banco fica sem par aqui', () => {
    const nossos = new Set(Object.keys(statuses));
    const doBanco = Object.entries(dbCopilot)
      .filter(([nome, valor]) => nome.startsWith('COPILOT_') && Array.isArray(valor))
      .map(([nome]) => nome);
    expect(doBanco.length).toBeGreaterThan(0);
    for (const nome of doBanco) expect(nossos.has(nome), nome).toBe(true);
  });
});
