import { describe, expect, it } from 'vitest';
import type { Role } from '@hm/shared';
import {
  MORE_ORDER,
  MOBILE_TAB_ORDER,
  NAV,
  activeNavItem,
  groupNavItems,
  isNavActive,
  mobileLabelOf,
  mobileTabItems,
  moreNavItems,
  visibleNavItems,
} from './nav';
import { sumUnread, unreadBadgeLabel } from './useInboxUnread';

const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'];

describe('nav.ts — fonte única dos destinos', () => {
  it('não repete href', () => {
    const hrefs = NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('as 4 abas do celular: Home, Inbox, Agenda e Mais (3 destinos + Mais)', () => {
    expect(MOBILE_TAB_ORDER).toEqual(['home', 'inbox', 'agenda']);
    const owner = visibleNavItems('OWNER');
    expect(mobileTabItems(owner).map(mobileLabelOf)).toEqual(['Home', 'Inbox', 'Agenda']);
  });

  it('o sheet "Mais" abre com Pipeline, Contatos, Campanhas, Agentes, Flows', () => {
    const labels = moreNavItems(visibleNavItems('OWNER')).map(mobileLabelOf);
    expect(labels.slice(0, 5)).toEqual(['Pipeline', 'Contatos', 'Campanhas', 'Agentes', 'Flows']);
    expect(labels).toEqual(expect.arrayContaining(['Conversões', 'Configurações', 'Ajuda']));
  });

  it('F72-S04: Home é `/` (aba home) e não existe mais um "Dashboard" separado', () => {
    const home = NAV.find((i) => i.tab === 'home');
    expect(home?.href).toBe('/');
    expect(home?.label).toBe('Home');
    expect(NAV.map((i) => i.href)).not.toContain('/hoje');
    expect(NAV.map((i) => i.label)).not.toContain('Dashboard');
    expect(moreNavItems(visibleNavItems('OWNER')).map((i) => i.href)).not.toContain('/');
  });

  it('MORE_ORDER cobre todo destino que não é aba (nada fica sem caminho no celular)', () => {
    const notTab = NAV.filter((i) => !i.tab).map((i) => i.href);
    expect([...notTab].sort()).toEqual([...MORE_ORDER].sort());
  });

  it.each(ROLES)('papel %s: todo destino visível tem caminho no celular (aba ou Mais)', (role) => {
    const items = visibleNavItems(role);
    const reachable = new Set(
      [...mobileTabItems(items), ...moreNavItems(items)].map((i) => i.href),
    );
    for (const item of items) expect(reachable.has(item.href), item.href).toBe(true);
    expect(reachable.size).toBe(items.length);
  });

  it('role-aware: quem não pode agir não vê (READONLY sem Backup de Flows nem Conhecimento)', () => {
    const hrefs = visibleNavItems('READONLY').map((i) => i.href);
    expect(hrefs).not.toContain('/flows/backup');
    expect(hrefs).not.toContain('/knowledge');
    expect(visibleNavItems(undefined).every((i) => !i.perm)).toBe(true);
  });

  it('nenhuma rota de custo de LLM ou infraestrutura na casca', () => {
    const text = NAV.map((i) => `${i.href} ${i.label}`)
      .join(' ')
      .toLowerCase();
    expect(text).not.toMatch(/custo|cost|llm|infra|token/);
  });

  it('agrupa na ordem dos grupos e descarta grupos vazios', () => {
    const groups = groupNavItems(visibleNavItems('OWNER')).map((g) => g.group);
    expect(groups).toEqual(['today', 'work', 'automate', 'manage']);
  });
});

describe('item ativo', () => {
  const items = visibleNavItems('OWNER');

  it('prefixo mais específico vence (Backup não acende Flows)', () => {
    expect(activeNavItem(items, '/flows/backup')?.href).toBe('/flows/backup');
    expect(activeNavItem(items, '/flows/abc/edit')?.href).toBe('/flows');
  });

  it('"/" é a Home e só casa exato', () => {
    expect(activeNavItem(items, '/')?.href).toBe('/');
    expect(activeNavItem(items, '/')?.label).toBe('Home');
    expect(activeNavItem(items, '/hoje')).toBeUndefined();
  });

  it('não confunde prefixos de nome parecido', () => {
    expect(activeNavItem(items, '/contacts-import')).toBeUndefined();
  });

  it('isNavActive marca um item só', () => {
    const active = items.filter((i) => isNavActive(i, items, '/settings/channels'));
    expect(active.map((i) => i.href)).toEqual(['/settings']);
  });
});

describe('selo de não lidas da Inbox', () => {
  it('soma ignorando valores inválidos', () => {
    expect(
      sumUnread([{ unreadCount: 2 }, { unreadCount: 0 }, { unreadCount: -3 }, { unreadCount: 5 }]),
    ).toBe(7);
    expect(sumUnread([])).toBe(0);
  });

  it('some em 0 e limita em 99+', () => {
    expect(unreadBadgeLabel(0)).toBeNull();
    expect(unreadBadgeLabel(12)).toBe('12');
    expect(unreadBadgeLabel(100)).toBe('99+');
  });
});
