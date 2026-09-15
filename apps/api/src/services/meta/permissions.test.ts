/**
 * F69-S02 — permissões por caso de uso.
 *
 * O que este arquivo protege: que a conexão peça exatamente o que o caso de uso
 * precisa, e que a tela saiba dizer qual caso de uso parou quando falta uma
 * permissão — em vez de a ação falhar no meio com um erro da Graph.
 */
import { describe, expect, it } from 'vitest';
import {
  connectionHealth,
  isMetaUseCase,
  missingByUseCase,
  parsePermissions,
  permissionsFor,
  USE_CASE_PERMISSIONS,
} from './permissions';

const agora = new Date('2026-09-14T12:00:00Z');
const DIA = 86_400_000;

describe('permissionsFor', () => {
  it('une as permissões de vários casos de uso sem repetir', () => {
    const p = permissionsFor(['leads', 'ads_read']);
    expect(new Set(p).size).toBe(p.length);
    expect(p).toContain('leads_retrieval');
    expect(p).toContain('ads_read');
  });

  it('WhatsApp não é caso de uso desta conexão — ele usa o Embedded Signup', () => {
    expect(isMetaUseCase('whatsapp')).toBe(false);
    expect(Object.values(USE_CASE_PERMISSIONS).flat()).not.toContain('whatsapp_business_messaging');
  });
});

describe('parsePermissions', () => {
  it('separa concedidas de negadas; expirada conta como negada', () => {
    const r = parsePermissions({
      data: [
        { permission: 'ads_read', status: 'granted' },
        { permission: 'leads_retrieval', status: 'declined' },
        { permission: 'pages_show_list', status: 'expired' },
      ],
    });
    expect(r.granted).toEqual(['ads_read']);
    expect(r.declined).toEqual(['leads_retrieval', 'pages_show_list']);
  });

  it('resposta malformada não lança', () => {
    for (const lixo of [null, 'x', {}, { data: 'x' }, { data: [null, 1, { status: 'granted' }] }]) {
      expect(parsePermissions(lixo)).toEqual({ granted: [], declined: [] });
    }
  });
});

describe('missingByUseCase', () => {
  it('lista só os casos de uso incompletos, com o que falta em cada um', () => {
    const faltas = missingByUseCase(['ads_read', 'leads'], ['ads_read', 'business_management']);
    expect(faltas.ads_read).toBeUndefined();
    expect(faltas.leads).toContain('leads_retrieval');
  });
});

describe('connectionHealth', () => {
  const base = {
    now: agora,
    status: 'active' as const,
    expiresAt: new Date(agora.getTime() + 30 * DIA),
    useCases: ['ads_read'] as const,
    granted: ['ads_read', 'business_management'],
  };

  it('tudo certo', () => {
    expect(connectionHealth(base)).toBe('ok');
  });

  it('revogada vence tudo', () => {
    expect(connectionHealth({ ...base, status: 'revoked' })).toBe('revoked');
  });

  it('expirada vence falta de permissão', () => {
    expect(
      connectionHealth({ ...base, expiresAt: new Date(agora.getTime() - 1), granted: [] }),
    ).toBe('expired');
  });

  it('falta de permissão', () => {
    expect(connectionHealth({ ...base, granted: ['ads_read'] })).toBe('missing_permissions');
  });

  it('perto de expirar avisa', () => {
    expect(connectionHealth({ ...base, expiresAt: new Date(agora.getTime() + 3 * DIA) })).toBe(
      'expiring',
    );
  });

  it('token sem expiração (usuário de sistema) não é problema', () => {
    expect(connectionHealth({ ...base, expiresAt: null })).toBe('ok');
  });
});
