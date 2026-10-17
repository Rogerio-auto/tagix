/**
 * F73-S05 — peças puras do motor: registro de executores, código de erro estável, throttle do
 * progresso, CSV (injeção de fórmula, PII de contato) e chave da ferramenta.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import type { CopilotProposalUpdatedPayload } from '@hm/shared';
import { csvCell, scrubContactPii } from './activity';
import { createExecutorRegistry } from './deps';
import { errorCodeOf } from './execute';
import { ProgressThrottle } from './progress';
import { proposeToolKey } from './propose';
import { FakeStore, fakeDealMoveExecutor, makeTestDeps } from './test-fixtures';
import type { ProposalEngineDeps } from './types';

afterEach(() => {
  vi.useRealTimers();
});

describe('createExecutorRegistry', () => {
  it('um executor por capacidade; repetido, desconhecido ou de consulta lança no boot', () => {
    const store = new FakeStore();
    const exec = fakeDealMoveExecutor(store);
    expect(createExecutorRegistry([exec]).get('deal.move')).toBe(exec);
    expect(() => createExecutorRegistry([exec, exec])).toThrow(/repetida/);
    expect(() => createExecutorRegistry([{ ...exec, capability: 'query' }])).toThrow(/escrita/);
    expect(() =>
      createExecutorRegistry([{ ...exec, capability: 'nada' as unknown as 'deal.move' }]),
    ).toThrow(/desconhecida/);
  });
});

describe('errorCodeOf', () => {
  it('só código estável; mensagem e SQLSTATE nunca', () => {
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'transition_rule' }))).toBe(
      'transition_rule',
    );
    expect(errorCodeOf(Object.assign(new Error('dup'), { code: '23505' }))).toBe('execution_error');
    expect(errorCodeOf(new Error('Maria, telefone 11 99999-0000'))).toBe('execution_error');
    expect(errorCodeOf('boom')).toBe('execution_error');
  });
});

describe('ProgressThrottle', () => {
  function payload(done: number): CopilotProposalUpdatedPayload {
    return {
      proposal_id: '00000000-0000-4000-8000-000000000001',
      status: 'executing',
      progress: { done, total: 200, failed: 0 },
      version: 2,
    };
  }

  it('lote de 200: no máximo um evento a cada 250 ms, e o final sempre sai', async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const deps: ProposalEngineDeps = {
      ...makeTestDeps(new FakeStore()),
      emit: async ({ payload: p }) => {
        sent.push(p.progress.done);
      },
      logger: createLogger('error', { svc: 'test' }),
    };
    const t = new ProgressThrottle(deps, 'ws', ['m1'], 250);
    for (let i = 1; i <= 200; i++) {
      t.push(payload(i));
      vi.advanceTimersByTime(5); // 200 itens em ~1 s
    }
    await t.flush({ ...payload(200), status: 'completed' });
    // 1 s / 250 ms ≈ 4 a 5 emissões + o final, nunca 200.
    expect(sent.length).toBeLessThanOrEqual(7);
    expect(sent.at(-1)).toBe(200);
  });

  it('falha do emissor não lança', async () => {
    const deps: ProposalEngineDeps = {
      ...makeTestDeps(new FakeStore()),
      emit: async () => {
        throw new Error('socket fora');
      },
    };
    const t = new ProgressThrottle(deps, 'ws', ['m1'], 0);
    t.push(payload(1));
    await expect(t.flush(payload(2))).resolves.toBeUndefined();
  });
});

describe('CSV', () => {
  it('mascara e-mail e telefone; mantém números curtos (contagens, R$)', () => {
    const text = scrubContactPii(
      'Mover 3 negócios de maria.souza@cliente.com.br (+55 (11) 98888-7777) e 11988887777 — R$ 38.500',
    );
    expect(text).not.toMatch(/maria|98888|7777|11988887777/);
    expect(text).toContain('[e-mail]');
    expect(text).toContain('[telefone]');
    expect(text).toContain('Mover 3 negócios');
    expect(text).toContain('R$ 38.500');
  });

  it('não mascara datas nem valores (o regex é pela forma do telefone, não por contar dígitos)', () => {
    for (const keep of [
      'Mover 7 negócios em 16/10/2026',
      'Agendado para 2026-10-16',
      'Executado em 2026-10-16T09:14:00.000Z',
      'Impacto de R$ 1.250.000,00 na previsão',
      'Total de 12.500 contatos',
      'Pipeline 2026 com 1250000 em aberto',
    ]) {
      expect(scrubContactPii(keep)).toBe(keep);
    }
    for (const phone of [
      '(11) 3333-4444',
      '98888-7777',
      '+55 11 98888 7777',
      '5511988887777',
      'ligar 11 3333 4444',
    ]) {
      expect(scrubContactPii(phone)).toContain('[telefone]');
      expect(scrubContactPii(phone)).not.toMatch(/\d{4}/);
    }
  });

  it('célula: aspas, separadores e defesa contra fórmula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`'+1`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
  });
});

describe('proposeToolKey', () => {
  it('propose_<capability> no formato de chave de ferramenta', () => {
    expect(proposeToolKey('deal.move')).toBe('propose_deal_move');
    expect(proposeToolKey('event.create_internal')).toBe('propose_event_create_internal');
  });
});
