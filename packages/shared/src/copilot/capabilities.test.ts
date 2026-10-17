/**
 * F73-S02 — catálogo e capacidades efetivas (COPILOTO.md §6.2, ADR-003 §3).
 *
 * O que este arquivo protege: (1) o catálogo é exatamente o da spec; (2) para os 5 papéis,
 * `effectiveCapabilities` nunca concede o que `can()` nega; (3) a matriz de
 * `copilot_settings` só restringe, nunca amplia.
 */
import { describe, expect, it } from 'vitest';
import { can, ROLES, type Permission, type Role } from '../permissions';
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  CAPABILITY_LABELS_PT,
  capabilityAllowed,
  capabilityPermission,
  copilotAccessFor,
  effectiveCapabilities,
  QUERY_AREAS,
  QUERY_STATUS_LABELS_PT,
  roleHasCapability,
  statusLabelFor,
  type CapabilityKey,
  type CapabilityMatrix,
} from './capabilities';

describe('permissões novas do Copiloto (ROLE_CAN)', () => {
  const esperado: Record<string, readonly Role[]> = {
    'copilot.use': ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'],
    'copilot.manage': ['OWNER', 'ADMIN'],
    'copilot.view_costs': ['OWNER', 'ADMIN'],
    'copilot.memory.edit': ['OWNER', 'ADMIN', 'SUPERVISOR'],
    'copilot.activity.view_all': ['OWNER', 'ADMIN', 'SUPERVISOR'],
    'copilot.autopilot.manage': ['OWNER', 'ADMIN'],
  };
  it.each(Object.entries(esperado))('%s', (perm, papeis) => {
    for (const role of ROLES) expect(can(role, perm as Permission)).toBe(papeis.includes(role));
  });
});

describe('CAPABILITIES — exatamente o catálogo da spec §6.2', () => {
  it('as chaves do catálogo são as de CAPABILITY_KEYS, e cada def conhece a sua chave', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...CAPABILITY_KEYS].sort());
    for (const k of CAPABILITY_KEYS) expect(CAPABILITIES[k].key).toBe(k);
  });

  const spec: Record<CapabilityKey, { base: 1 | 2 | 4; perm: Permission; undo: boolean; kind: 'query' | 'write' }> = {
    query: { base: 1, perm: 'copilot.use', undo: false, kind: 'query' },
    'contact.tag': { base: 2, perm: 'contact.edit', undo: true, kind: 'write' },
    'contact.update': { base: 2, perm: 'contact.edit', undo: true, kind: 'write' },
    'deal.assign_owner': { base: 2, perm: 'deal.edit', undo: true, kind: 'write' },
    'deal.move': { base: 2, perm: 'deal.move', undo: true, kind: 'write' },
    'conversation.note': { base: 2, perm: 'conversation.assign', undo: true, kind: 'write' },
    'event.create_internal': { base: 2, perm: 'event.edit', undo: true, kind: 'write' },
    'memory.remember': { base: 2, perm: 'copilot.memory.edit', undo: true, kind: 'write' },
    'message.send': { base: 4, perm: 'conversation.assign', undo: false, kind: 'write' },
    'campaign.pause': { base: 4, perm: 'campaign.pause', undo: true, kind: 'write' },
    'campaign.resume': { base: 4, perm: 'campaign.pause', undo: true, kind: 'write' },
    'campaign.cancel': { base: 4, perm: 'campaign.cancel', undo: false, kind: 'write' },
    'flow.trigger': { base: 4, perm: 'flow.trigger', undo: true, kind: 'write' },
  };

  it.each(CAPABILITY_KEYS)('%s: nível base, permissão (1 alvo), desfazer e tipo', (k) => {
    const def = CAPABILITIES[k];
    const s = spec[k];
    expect(def.baseRisk).toBe(s.base);
    expect(capabilityPermission(k, 1)).toBe(s.perm);
    expect(def.undoable).toBe(s.undo);
    expect(def.kind).toBe(s.kind);
  });

  it('base 4 é sempre externa ou irreversível; base 2 nunca é', () => {
    for (const k of CAPABILITY_KEYS) {
      const def = CAPABILITIES[k];
      expect(def.external || def.irreversible).toBe(def.baseRisk === 4);
    }
  });

  it('cancelar campanha e mandar mensagem são irreversíveis', () => {
    expect(CAPABILITIES['campaign.cancel'].irreversible).toBe(true);
    expect(CAPABILITIES['message.send'].irreversible).toBe(true);
  });

  it('message.send: 1 alvo é atendimento; 2 ou mais é disparo', () => {
    expect(capabilityPermission('message.send', 0)).toBe('conversation.assign');
    expect(capabilityPermission('message.send', 1)).toBe('conversation.assign');
    expect(capabilityPermission('message.send', 2)).toBe('campaign.edit');
    expect(capabilityPermission('message.send', 200)).toBe('campaign.edit');
  });

  it('só message.send tem permissão dependente de volume', () => {
    for (const k of CAPABILITY_KEYS) {
      if (k === 'message.send') continue;
      expect(capabilityPermission(k, 1)).toBe(capabilityPermission(k, 200));
    }
  });
});

describe('rótulos (catálogo, nunca o modelo)', () => {
  it('toda capacidade tem nome, descrição e rótulo de status', () => {
    for (const k of CAPABILITY_KEYS) {
      const l = CAPABILITY_LABELS_PT[k];
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.description.length).toBeGreaterThan(0);
      expect(l.status.endsWith('…')).toBe(true);
      expect(CAPABILITIES[k].label).toBe(l.name);
    }
  });

  it('status de consulta diz o que está sendo lido', () => {
    expect(statusLabelFor('query', 'pipeline')).toEqual({ phase: 'reading', label: 'Lendo o pipeline…' });
    expect(statusLabelFor('query')).toEqual({ phase: 'reading', label: CAPABILITY_LABELS_PT.query.status });
    for (const a of QUERY_AREAS) expect(QUERY_STATUS_LABELS_PT[a].endsWith('…')).toBe(true);
  });

  it('status de escrita é "acting"', () => {
    expect(statusLabelFor('deal.move')).toEqual({ phase: 'acting', label: 'Preparando a movimentação…' });
  });
});

/** Gerador determinístico (LCG) para matrizes "aleatórias" reprodutíveis. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function matrizAleatoria(r: () => number): CapabilityMatrix {
  const m: CapabilityMatrix = {};
  for (const role of ROLES) {
    const linha: Partial<Record<CapabilityKey | 'use', boolean>> = {};
    for (const k of [...CAPABILITY_KEYS, 'use'] as const) {
      const x = r();
      if (x < 0.33) linha[k] = false;
      else if (x < 0.66) linha[k] = true;
      // senão: ausente (herda)
    }
    m[role] = linha;
  }
  return m;
}

const tudoTrue: CapabilityMatrix = Object.fromEntries(
  ROLES.map((role) => [role, Object.fromEntries([...CAPABILITY_KEYS, 'use'].map((k) => [k, true]))]),
);
const tudoFalse: CapabilityMatrix = Object.fromEntries(
  ROLES.map((role) => [role, Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false]))]),
);

describe('effectiveCapabilities — 5 papéis × catálogo', () => {
  it.each(ROLES)('%s sem matriz: permitido exatamente quando can() permite', (role) => {
    const ef = effectiveCapabilities(role, null);
    for (const k of CAPABILITY_KEYS) {
      const pode = can(role, 'copilot.use') && can(role, capabilityPermission(k, 1));
      expect(ef[k].allowed).toBe(pode);
      expect(ef[k].reason).toBe(pode ? undefined : 'role');
      expect(roleHasCapability(role, k)).toBe(pode);
    }
  });

  it.each(ROLES)('%s com tudo `true` na matriz: a matriz não concede nada', (role) => {
    expect(effectiveCapabilities(role, tudoTrue)).toEqual(effectiveCapabilities(role, undefined));
  });

  it.each(ROLES)('%s com tudo `false`: nada permitido; motivo distingue papel de dono', (role) => {
    const ef = effectiveCapabilities(role, tudoFalse);
    for (const k of CAPABILITY_KEYS) {
      expect(ef[k].allowed).toBe(false);
      expect(ef[k].reason).toBe(roleHasCapability(role, k) ? 'disabled_by_owner' : 'role');
    }
  });

  it('500 matrizes reprodutíveis: nunca concede o que can() nega, e só restringe', () => {
    const r = rng(73);
    for (let i = 0; i < 500; i++) {
      const m = matrizAleatoria(r);
      for (const role of ROLES) {
        const com = effectiveCapabilities(role, m);
        const sem = effectiveCapabilities(role, null);
        for (const k of CAPABILITY_KEYS) {
          if (com[k].allowed) {
            expect(can(role, capabilityPermission(k, 1))).toBe(true);
            expect(sem[k].allowed).toBe(true);
            expect(m[role]?.[k]).not.toBe(false);
            expect(m[role]?.use).not.toBe(false);
          }
        }
      }
    }
  });

  it('`use: false` desliga o Copiloto inteiro para o papel', () => {
    const m: CapabilityMatrix = { AGENT: { use: false } };
    expect(copilotAccessFor('AGENT', m)).toEqual({ allowed: false, reason: 'disabled_by_owner' });
    const ef = effectiveCapabilities('AGENT', m);
    for (const k of CAPABILITY_KEYS) expect(ef[k].allowed).toBe(false);
    // Os outros papéis não são afetados.
    expect(effectiveCapabilities('SUPERVISOR', m)).toEqual(effectiveCapabilities('SUPERVISOR', null));
  });

  it('READONLY só consulta', () => {
    const ef = effectiveCapabilities('READONLY', null);
    expect(CAPABILITY_KEYS.filter((k) => ef[k].allowed)).toEqual(['query']);
  });

  it('AGENT: move negócios e dispara flow, mas não mexe em campanha nem ensina fato', () => {
    const ef = effectiveCapabilities('AGENT', null);
    expect(ef['deal.move'].allowed).toBe(true);
    expect(ef['flow.trigger'].allowed).toBe(true);
    expect(ef['message.send'].allowed).toBe(true);
    expect(ef['campaign.pause'].allowed).toBe(false);
    expect(ef['campaign.cancel'].allowed).toBe(false);
    expect(ef['memory.remember'].allowed).toBe(false);
  });

  it('volume na chamada: AGENT manda a 1 contato, não a 2 (campaign.edit)', () => {
    expect(capabilityAllowed('AGENT', null, 'message.send', 1).allowed).toBe(true);
    expect(capabilityAllowed('AGENT', null, 'message.send', 2)).toEqual({ allowed: false, reason: 'role' });
    expect(capabilityAllowed('SUPERVISOR', null, 'message.send', 12).allowed).toBe(true);
  });

  it('capabilityAllowed com a matriz desligando a capacidade', () => {
    const m: CapabilityMatrix = { SUPERVISOR: { 'campaign.pause': false } };
    expect(capabilityAllowed('SUPERVISOR', m, 'campaign.pause')).toEqual({
      allowed: false,
      reason: 'disabled_by_owner',
    });
    expect(capabilityAllowed('ADMIN', m, 'campaign.pause').allowed).toBe(true);
  });
});
