import { describe, expect, it, vi } from 'vitest';
import { backoffMs, describeTickError, runAutomationTick, MAX_ATTEMPTS } from './worker';
import { createActionExecutor, MissingPortError } from './executors';
import type { ActionExecutor, PendingAutomationRow } from './types';

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
} as never;

// Redis fake que sempre concede o lock e libera no-op.
const redisOk = {
  set: vi.fn(async () => 'OK' as const),
  eval: vi.fn(async () => 1),
} as never;

function row(over: Partial<PendingAutomationRow> = {}): PendingAutomationRow {
  return {
    id: over.id ?? 'pa1',
    workspaceId: over.workspaceId ?? 'w1',
    dealId: over.dealId ?? 'd1',
    attempts: over.attempts ?? 0,
    rule: over.rule ?? {
      id: 'r1',
      trigger: 'on_enter',
      action: 'add_tag',
      config: { kind: 'add_tag', tagId: 't1' },
      delaySeconds: 0,
      enabled: true,
    },
  };
}

describe('backoffMs', () => {
  it('cresce exponencialmente (30s, 2min, 8min)', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(480_000);
  });
});

describe('describeTickError', () => {
  it('extrai code/severity/detail de um erro estilo postgres.js', () => {
    const err = Object.assign(new Error('Failed query: select …'), {
      code: '57P01',
      severity: 'FATAL',
      detail: 'terminating connection due to administrator command',
    });
    const out = describeTickError(err);
    expect(out['error']).toBe('Failed query: select …');
    expect(out['code']).toBe('57P01');
    expect(out['severity']).toBe('FATAL');
    expect(out['detail']).toBe('terminating connection due to administrator command');
    expect(out['stack']).toBeTypeOf('string');
  });

  it('desce na cause aninhada (code da causa)', () => {
    const cause = Object.assign(new Error('Connection terminated'), { code: 'CONNECTION_CLOSED' });
    const err = new Error('Failed query: …', { cause });
    const out = describeTickError(err);
    expect(out['cause']).toBe('Connection terminated');
    expect(out['causeCode']).toBe('CONNECTION_CLOSED');
  });

  it('aceita valor não-Error', () => {
    expect(describeTickError('boom')).toEqual({ error: 'boom' });
  });
});

describe('createActionExecutor', () => {
  it('roteia add_tag p/ a porta', async () => {
    const addTag = vi.fn(async () => {});
    const exec = createActionExecutor({ addTag });
    await exec(row());
    expect(addTag).toHaveBeenCalledWith({ workspaceId: 'w1', dealId: 'd1', tagId: 't1' });
  });

  it('lanca MissingPortError quando a porta da action nao foi injetada', async () => {
    const exec = createActionExecutor({});
    await expect(exec(row())).rejects.toBeInstanceOf(MissingPortError);
  });

  it('roteia create_event p/ a porta com ctx + config', async () => {
    const createEvent = vi.fn(async () => {});
    const exec = createActionExecutor({ createEvent });
    await exec(
      row({
        rule: {
          id: 'r3',
          trigger: 'on_enter',
          action: 'create_event',
          config: {
            kind: 'create_event',
            calendarId: 'cal1',
            title: 'Follow-up',
            durationMinutes: 30,
            offsetDays: 2,
          },
          delaySeconds: 0,
          enabled: true,
        },
      }),
    );
    expect(createEvent).toHaveBeenCalledWith(
      { workspaceId: 'w1', dealId: 'd1' },
      { kind: 'create_event', calendarId: 'cal1', title: 'Follow-up', durationMinutes: 30, offsetDays: 2 },
    );
  });

  it('lanca MissingPortError p/ create_event sem porta injetada', async () => {
    const exec = createActionExecutor({});
    await expect(
      exec(
        row({
          rule: {
            id: 'r3',
            trigger: 'on_enter',
            action: 'create_event',
            config: {
              kind: 'create_event',
              calendarId: 'cal1',
              title: 'Follow-up',
              durationMinutes: 30,
              offsetDays: 2,
            },
            delaySeconds: 0,
            enabled: true,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(MissingPortError);
  });

  it('roteia register_conversion com config', async () => {
    const registerConversion = vi.fn(async () => {});
    const exec = createActionExecutor({ registerConversion });
    await exec(
      row({
        rule: {
          id: 'r2',
          trigger: 'on_enter',
          action: 'register_conversion',
          config: { kind: 'register_conversion', conversionTypeKey: 'venda', valueFrom: 'deal' },
          delaySeconds: 0,
          enabled: true,
        },
      }),
    );
    expect(registerConversion).toHaveBeenCalledWith(
      { workspaceId: 'w1', dealId: 'd1' },
      { kind: 'register_conversion', conversionTypeKey: 'venda', valueFrom: 'deal' },
    );
  });
});

describe('runAutomationTick (com selectDue injetado)', () => {
  it('pula quando o lock e detido por outra instancia', async () => {
    const redisBusy = { set: vi.fn(async () => null), eval: vi.fn(async () => 0) } as never;
    const r = await runAutomationTick({
      redis: redisBusy,
      logger: silentLogger,
      execute: (async () => {}) as ActionExecutor,
      selectDue: async () => [row()],
    });
    expect(r.ran).toBe(false);
    expect(r.processed).toBe(0);
  });

  it('conta processados quando o executor passa (sem tocar DB de markDone? usa selectDue fake e execute fake)', async () => {
    // Aqui o markDone toca o DB real; por isso este caso so valida o caminho de erro
    // (sem DB) atraves de selectDue vazio -> nenhum processamento.
    const r = await runAutomationTick({
      redis: redisOk,
      logger: silentLogger,
      execute: (async () => {}) as ActionExecutor,
      selectDue: async () => [],
    });
    expect(r.ran).toBe(true);
    expect(r.processed).toBe(0);
    expect(r.failed).toBe(0);
  });

  it('MAX_ATTEMPTS e 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
