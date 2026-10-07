/**
 * F71-S07 — Membros e convites. Render estático (vitest em `node`) com as queries
 * mockadas: lista de pendentes com as 3 ações, status legível, filtro de removidos,
 * vazio/carregando/erro. O comportamento das ações (reenviar/revogar/copiar/limite)
 * é provado em `features/invites/actions.test.ts`.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import type { Member } from './queries';
import type { InvitesList, PublicInvite } from '@/features/invites/types';

Reflect.set(globalThis, 'React', React);

const pending: PublicInvite = {
  id: 'i1',
  email: 'bia@acme.com',
  role: 'AGENT',
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-08T00:00:00.000Z',
  expired: false,
  lastSentAt: '2026-10-01T00:00:00.000Z',
  sendCount: 1,
  resendsLeft: 5,
};

const member = (over: Partial<Member>): Member => ({
  id: 'm1',
  email: 'ana@acme.com',
  name: 'Ana',
  role: 'OWNER',
  status: 'active',
  avatarUrl: null,
  isOnline: false,
  lastSeenAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

interface Q<T> {
  isLoading: boolean;
  isError: boolean;
  data: T | undefined;
  refetch: () => void;
}
const state: { members: Q<{ members: Member[] }>; invites: Q<InvitesList> } = {
  members: { isLoading: false, isError: false, data: { members: [] }, refetch: () => undefined },
  invites: {
    isLoading: false,
    isError: false,
    data: { invites: [], seats: { used: 3, limit: 5 } },
    refetch: () => undefined,
  },
};

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => undefined }) }));

vi.mock('./queries', () => ({
  useMembers: () => state.members,
  useDepartments: () => ({ data: { departments: [] } }),
  useUpdateMember: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useRemoveMember: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

vi.mock('@/features/invites/queries', () => ({
  useInvites: () => state.invites,
  useCreateInvite: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: (sel: (s: { auth: { role: string } }) => unknown) => sel({ auth: { role: 'OWNER' } }),
}));

vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});

const { default: MembersSection, memberStatusLabel } = await import('./MembersSection');

const html = () => renderToStaticMarkup(<MembersSection />);

describe('MembersSection (F71-S07)', () => {
  beforeEach(() => {
    state.members = {
      isLoading: false,
      isError: false,
      data: { members: [member({})] },
      refetch: () => undefined,
    };
    state.invites = {
      isLoading: false,
      isError: false,
      data: { invites: [], seats: { used: 3, limit: 5 } },
      refetch: () => undefined,
    };
  });

  it('status legível, nunca o valor cru da API', () => {
    expect(memberStatusLabel('active')).toBe('Ativo');
    expect(memberStatusLabel('inactive')).toBe('Removido');
    expect(memberStatusLabel('blocked')).toBe('Bloqueado');
    expect(memberStatusLabel('invited')).toBe('Convite pendente');
  });

  it('convites pendentes: email, papel, enviado há X, expira em Y e as 3 ações', () => {
    state.invites.data = { invites: [pending], seats: { used: 3, limit: 5 } };
    const out = html();
    expect(out).toContain('bia@acme.com');
    expect(out).toContain('Atendente');
    expect(out).toContain('enviado');
    expect(out).toContain('Reenviar convite para bia@acme.com');
    expect(out).toContain('Copiar link do convite de bia@acme.com');
    expect(out).toContain('Revogar convite de bia@acme.com');
  });

  it('convite vencido é sinalizado; sem reenvios restantes o botão fica desabilitado', () => {
    state.invites.data = {
      invites: [{ ...pending, expired: true, resendsLeft: 0 }],
      seats: { used: 3, limit: 5 },
    };
    const out = html();
    expect(out).toContain('expirado');
    expect(out).toContain('Limite de reenvios atingido: copie o link');
  });

  it('vagas: mostra uso e teto; teto nulo = sem limite', () => {
    expect(html()).toContain('de 5 vagas em uso');
    state.invites.data = { invites: [], seats: { used: 3, limit: null } };
    expect(html()).toContain('plano sem limite');
  });

  it('vazio: convites pendentes com CTA', () => {
    const out = html();
    expect(out).toContain('Nenhum convite pendente');
    expect(out).toContain('Convidar membro');
  });

  it('carregando convites: esqueleto anunciado, membros seguem visíveis', () => {
    state.invites = { ...state.invites, isLoading: true, data: undefined };
    const out = html();
    expect(out).toContain('Carregando convites');
    expect(out).toContain('ana@acme.com');
  });

  it('erro nos convites: ErrorState em 3 partes com retry', () => {
    state.invites = { ...state.invites, isError: true, data: undefined };
    const out = html();
    expect(out).toContain('Não foi possível carregar os convites');
    expect(out).toContain('Tentar de novo');
  });

  it('carregando membros: esqueleto; erro de membros: ErrorState', () => {
    state.members = { ...state.members, isLoading: true, data: undefined };
    expect(html()).toContain('Carregando membros');
    state.members = { ...state.members, isLoading: false, isError: true };
    expect(html()).toContain('Não foi possível carregar os membros');
  });

  it('removidos ficam ocultos por padrão e o filtro mostra quantos há', () => {
    state.members.data = {
      members: [
        member({}),
        member({ id: 'm2', email: 'cris@acme.com', name: 'Cris', role: 'AGENT', status: 'inactive' }),
      ],
    };
    const out = html();
    expect(out).not.toContain('cris@acme.com');
    expect(out).toContain('Mostrar removidos (1)');
  });

  it('membro bloqueado mostra o selo; convite legado oferece convidar de novo', () => {
    state.members.data = {
      members: [
        member({ id: 'm3', email: 'dan@acme.com', name: 'Dan', role: 'AGENT', status: 'blocked' }),
        member({
          id: 'm4',
          email: 'eli@acme.com',
          name: null,
          role: 'AGENT',
          status: 'invited',
          legacyInvite: true,
        }),
      ],
    };
    const out = html();
    expect(out).toContain('Bloqueado');
    expect(out).toContain('Convidar de novo');
    expect(out).toContain('convite antigo');
  });

  it('não usa cor fixa (só tokens do DS v2)', () => {
    state.invites.data = { invites: [pending], seats: { used: 5, limit: 5 } };
    expect(html()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
