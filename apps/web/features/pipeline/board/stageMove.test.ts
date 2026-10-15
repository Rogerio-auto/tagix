/**
 * Mover negócio sem arrastar (F72-S06): regras puras por trás do menu "Mover para etapa",
 * do atalho Shift + ←/→ e do foco itinerante do menu. O vitest do @hm/web roda em `node`
 * (sem DOM); a interação real fica no e2e `specs/pipeline-ds3.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  adjacentStageId,
  findContainer,
  groupDealIds,
  isTransitionBlocked,
  moveToContainer,
  applyMove,
  clearPending,
  compareServerOrder,
  prunePending,
  revertMove,
  setPending,
  moveAnnouncement,
  moveOptions,
  moveShortcut,
  nextMenuIndex,
  transitionBlockedReason,
  type MoveKeyEvent,
} from './stageMove';
import type { Stage } from './types';

function stage(id: string, position: number, allowedFrom?: string[]): Stage {
  return {
    id,
    pipelineId: 'p1',
    name: id.toUpperCase(),
    color: 'var(--info)',
    icon: null,
    position,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [],
    transitionRules: allowedFrom ? { allowedFromStageIds: allowedFrom } : {},
  };
}

// Fora de ordem de propósito: a ordem do funil é `position`, não a do array.
const STAGES = [stage('won', 3), stage('lead', 0), stage('proposal', 2), stage('qualified', 1)];

const key = (k: string, mods: Partial<MoveKeyEvent> = {}): MoveKeyEvent => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('moveShortcut', () => {
  it('Shift + → avança e Shift + ← volta', () => {
    expect(moveShortcut(key('ArrowRight', { shiftKey: true }))).toBe(1);
    expect(moveShortcut(key('ArrowLeft', { shiftKey: true }))).toBe(-1);
  });

  it('seta sem Shift é do dnd-kit/rolagem, não move', () => {
    expect(moveShortcut(key('ArrowRight'))).toBeNull();
    expect(moveShortcut(key('ArrowLeft'))).toBeNull();
  });

  it('Alt/Ctrl/Cmd nunca disparam (voltar página, atalhos do sistema)', () => {
    expect(moveShortcut(key('ArrowLeft', { shiftKey: true, altKey: true }))).toBeNull();
    expect(moveShortcut(key('ArrowRight', { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(moveShortcut(key('ArrowRight', { shiftKey: true, metaKey: true }))).toBeNull();
  });

  it('outras teclas com Shift não movem', () => {
    expect(moveShortcut(key('ArrowUp', { shiftKey: true }))).toBeNull();
    expect(moveShortcut(key('Enter', { shiftKey: true }))).toBeNull();
    expect(moveShortcut(key(' ', { shiftKey: true }))).toBeNull();
  });
});

describe('adjacentStageId', () => {
  it('segue a ordem do funil (position), não a do array', () => {
    expect(adjacentStageId(STAGES, { stageId: 'lead' }, 1)).toBe('qualified');
    expect(adjacentStageId(STAGES, { stageId: 'proposal' }, -1)).toBe('qualified');
    expect(adjacentStageId(STAGES, { stageId: 'proposal' }, 1)).toBe('won');
  });

  it('nas pontas não há para onde ir', () => {
    expect(adjacentStageId(STAGES, { stageId: 'lead' }, -1)).toBeNull();
    expect(adjacentStageId(STAGES, { stageId: 'won' }, 1)).toBeNull();
  });

  it('pula a etapa que a regra de transição bloqueia', () => {
    const stages = [stage('a', 0), stage('b', 1, ['x']), stage('c', 2)];
    expect(adjacentStageId(stages, { stageId: 'a' }, 1)).toBe('c');
  });

  it('nada adiante aceita: null', () => {
    const stages = [stage('a', 0), stage('b', 1, ['x']), stage('c', 2, ['x'])];
    expect(adjacentStageId(stages, { stageId: 'a' }, 1)).toBeNull();
  });

  it('etapa atual desconhecida: null (não inventa destino)', () => {
    expect(adjacentStageId(STAGES, { stageId: 'sumiu' }, 1)).toBeNull();
  });
});

describe('moveOptions', () => {
  it('lista na ordem do funil, marca a atual e as bloqueadas', () => {
    const stages = [stage('b', 1, ['x']), stage('a', 0), stage('c', 2, ['a'])];
    const opts = moveOptions(stages, { stageId: 'a' });
    expect(opts.map((o) => o.stage.id)).toEqual(['a', 'b', 'c']);
    expect(opts.map((o) => o.current)).toEqual([true, false, false]);
    expect(opts.map((o) => o.blocked)).toEqual([false, true, false]);
  });
});

describe('transição', () => {
  it('sem regra, tudo é permitido', () => {
    expect(isTransitionBlocked(stage('a', 0), 'qualquer')).toBe(false);
    expect(transitionBlockedReason(STAGES, { stageId: 'lead' }, 'won')).toBeNull();
  });

  it('com regra, só as origens listadas entram; o motivo nomeia a etapa', () => {
    const stages = [stage('a', 0), stage('b', 1, ['c'])];
    expect(isTransitionBlocked(stages[1] as Stage, 'a')).toBe(true);
    expect(isTransitionBlocked(stages[1] as Stage, 'c')).toBe(false);
    expect(transitionBlockedReason(stages, { stageId: 'a' }, 'b')).toContain('"B"');
  });

  it('destino desconhecido não é bloqueio (o servidor decide)', () => {
    expect(transitionBlockedReason(STAGES, { stageId: 'lead' }, 'sumiu')).toBeNull();
  });
});

describe('nextMenuIndex (foco itinerante do menu)', () => {
  const enabled = [false, true, true, false, true];

  it('↓/↑ pulam itens desabilitados e dão a volta', () => {
    expect(nextMenuIndex(enabled, 1, 'ArrowDown')).toBe(2);
    expect(nextMenuIndex(enabled, 2, 'ArrowDown')).toBe(4);
    expect(nextMenuIndex(enabled, 4, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(enabled, 1, 'ArrowUp')).toBe(4);
    expect(nextMenuIndex(enabled, 4, 'ArrowUp')).toBe(2);
  });

  it('Home/End vão ao primeiro/último habilitado', () => {
    expect(nextMenuIndex(enabled, 2, 'Home')).toBe(1);
    expect(nextMenuIndex(enabled, 1, 'End')).toBe(4);
  });

  it('sem foco ainda: ↓ entra no primeiro, ↑ no último', () => {
    expect(nextMenuIndex(enabled, -1, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(enabled, -1, 'ArrowUp')).toBe(4);
  });

  it('tecla que não navega, ou nada habilitado: null', () => {
    expect(nextMenuIndex(enabled, 1, 'a')).toBeNull();
    expect(nextMenuIndex([false, false], 0, 'ArrowDown')).toBeNull();
    expect(nextMenuIndex([], 0, 'ArrowDown')).toBeNull();
  });
});

describe('moveAnnouncement', () => {
  it('diz o que mudou e para onde', () => {
    expect(moveAnnouncement('Cozinha', 'Proposta')).toBe('"Cozinha" movido para a etapa "Proposta".');
  });
});

// Drag multi-container: o placeholder viaja de coluna em coluna (estado local do board).
describe('groupDealIds', () => {
  const deals = [
    { id: 'd1', stageId: 'lead', position: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'd2', stageId: 'qualified', position: 0, createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'd3', stageId: 'lead', position: 0, createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'orphan', stageId: 'gone', position: 0 },
  ];
  it('agrupa por etapa na ordem do servidor, mantém vazias e ignora etapa inexistente', () => {
    expect(groupDealIds(STAGES, deals)).toEqual({
      won: [],
      lead: ['d3', 'd1'],
      proposal: [],
      qualified: ['d2'],
    });
  });
  it('aplica o movimento pendente (ponte até o otimista)', () => {
    const items = groupDealIds(STAGES, deals, new Map([['d1', 'proposal']]));
    expect(items['lead']).toEqual(['d3']);
    expect(items['proposal']).toEqual(['d1']);
  });
  it('o card pendente entra no lugar que o servidor vai dar (position 0), não no fim', () => {
    const items = groupDealIds(STAGES, deals, new Map([['d1', 'qualified']]));
    // d1 é mais antigo que d2: com position empatada em 0, createdAt desc põe d2 antes.
    expect(items['qualified']).toEqual(['d2', 'd1']);
    const newer = groupDealIds(STAGES, deals, new Map([['d3', 'qualified']]));
    expect(newer['qualified']).toEqual(['d3', 'd2']);
  });
  it('vários pendentes ao mesmo tempo (um por deal)', () => {
    const items = groupDealIds(STAGES, deals, new Map([['d1', 'won'], ['d3', 'proposal']]));
    expect(items).toEqual({ won: ['d1'], lead: [], proposal: ['d3'], qualified: ['d2'] });
  });
  it('o board volta à ordem do servidor: mesma entrada, mesma ordem (sem ordem local)', () => {
    expect(groupDealIds(STAGES, [...deals].reverse())).toEqual(groupDealIds(STAGES, deals));
  });
});

describe('compareServerOrder', () => {
  it('position asc, depois createdAt desc; empate total = 0 (sort estável)', () => {
    const a = { id: 'a', stageId: 's', position: 0, createdAt: '2026-01-01' };
    const b = { id: 'b', stageId: 's', position: 1, createdAt: '2026-02-01' };
    const c = { id: 'c', stageId: 's', position: 0, createdAt: '2026-03-01' };
    expect([b, a, c].sort(compareServerOrder).map((d) => d.id)).toEqual(['c', 'a', 'b']);
    expect(compareServerOrder(a, { ...a, id: 'z' })).toBe(0);
  });
});

describe('movimentos pendentes (Map por deal)', () => {
  it('setPending registra e substitui; mesmo destino devolve a MESMA referência', () => {
    const empty = new Map<string, string>();
    const one = setPending(empty, 'd1', 'won');
    expect([...one]).toEqual([['d1', 'won']]);
    expect(empty.size).toBe(0);
    expect(setPending(one, 'd1', 'won')).toBe(one);
    const two = setPending(one, 'd2', 'lead');
    expect(two.get('d1')).toBe('won');
    expect(two.get('d2')).toBe('lead');
  });
  it('clearPending do 1º movimento não apaga o 2º (outro deal ou destino mais novo)', () => {
    const p = new Map([['d1', 'won'], ['d2', 'lead']]);
    expect([...clearPending(p, 'd1', 'won')]).toEqual([['d2', 'lead']]);
    // d1 foi movido de novo (agora para "lead"): o fim do movimento antigo não o apaga.
    const renewed = new Map([['d1', 'lead']]);
    expect(clearPending(renewed, 'd1', 'won')).toBe(renewed);
  });
  it('prunePending descarta o que o cache já reflete ou que sumiu', () => {
    const p = new Map([['d1', 'won'], ['d2', 'lead'], ['gone', 'lead']]);
    const stageOf = (id: string): string | undefined =>
      ({ d1: 'won', d2: 'qualified' } as Record<string, string | undefined>)[id];
    expect([...prunePending(p, stageOf)]).toEqual([['d2', 'lead']]);
    const none = new Map([['d2', 'lead']]);
    expect(prunePending(none, stageOf)).toBe(none);
  });
});

describe('applyMove / revertMove (otimista por deal)', () => {
  const deals = [
    { id: 'd1', stageId: 'lead', position: 3, updatedAt: null },
    { id: 'd2', stageId: 'lead', position: 1, updatedAt: null },
  ];
  it('applyMove grava etapa, position 0 e updatedAt só no deal movido', () => {
    const moved = applyMove(deals, 'd1', 'won', '2026-10-14T00:00:00.000Z');
    expect(moved[0]).toEqual({ id: 'd1', stageId: 'won', position: 0, updatedAt: '2026-10-14T00:00:00.000Z' });
    expect(moved[1]).toBe(deals[1]);
  });
  it('dois movimentos em voo: o erro do 1º desfaz só ele, o 2º continua', () => {
    const afterFirst = applyMove(deals, 'd1', 'won', 't1');
    const afterSecond = applyMove(afterFirst, 'd2', 'proposal', 't2');
    const reverted = revertMove(afterSecond, deals, 'd1', 'won');
    expect(reverted.find((d) => d.id === 'd1')?.stageId).toBe('lead');
    expect(reverted.find((d) => d.id === 'd2')?.stageId).toBe('proposal');
  });
  it('não desfaz se o deal já foi movido de novo depois do movimento que falhou', () => {
    const again = applyMove(applyMove(deals, 'd1', 'won', 't1'), 'd1', 'proposal', 't2');
    expect(revertMove(again, deals, 'd1', 'won').find((d) => d.id === 'd1')?.stageId).toBe('proposal');
  });
});

describe('findContainer', () => {
  const items = { lead: ['d1'], qualified: ['d2'] };
  it('acha a etapa de um item e reconhece a própria etapa', () => {
    expect(findContainer(items, 'd2')).toBe('qualified');
    expect(findContainer(items, 'lead')).toBe('lead');
    expect(findContainer(items, 'nada')).toBeUndefined();
  });
  it('não confunde chaves herdadas do Object com etapas', () => {
    expect(findContainer(items, 'toString')).toBeUndefined();
  });
});

describe('moveToContainer', () => {
  const items = { lead: ['a', 'b'], qualified: ['c', 'd'], proposal: [] as string[] };

  it('sobre um item: entra na posição dele (antes, ou depois na metade de baixo)', () => {
    expect(moveToContainer(items, 'a', 'd')).toEqual({
      lead: ['b'],
      qualified: ['c', 'a', 'd'],
      proposal: [],
    });
    expect(moveToContainer(items, 'a', 'd', { after: true })['qualified']).toEqual(['c', 'd', 'a']);
  });

  it('sobre a coluna (vazia ou não): entra no fim', () => {
    expect(moveToContainer(items, 'b', 'proposal')['proposal']).toEqual(['b']);
    expect(moveToContainer(items, 'b', 'qualified')['qualified']).toEqual(['c', 'd', 'b']);
  });

  it('não muta a entrada', () => {
    moveToContainer(items, 'a', 'qualified');
    expect(items).toEqual({ lead: ['a', 'b'], qualified: ['c', 'd'], proposal: [] });
  });

  it('mesma coluna, alvo desconhecido ou nada sob o cursor: devolve a MESMA referência', () => {
    expect(moveToContainer(items, 'a', 'b')).toBe(items);
    expect(moveToContainer(items, 'a', 'lead')).toBe(items);
    expect(moveToContainer(items, 'a', 'nada')).toBe(items);
    expect(moveToContainer(items, 'nada', 'qualified')).toBe(items);
  });

  it('respeita a regra de transição: coluna recusada não recebe o placeholder', () => {
    const canEnter = (to: string): boolean => to !== 'proposal';
    expect(moveToContainer(items, 'a', 'proposal', { canEnter })).toBe(items);
    expect(moveToContainer(items, 'a', 'qualified', { canEnter })['qualified']).toEqual(['c', 'd', 'a']);
  });

  it('o card volta para a origem (passou por B e retornou a A)', () => {
    const inB = moveToContainer(items, 'a', 'qualified');
    expect(moveToContainer(inB, 'a', 'b')).toEqual(items);
  });
});

