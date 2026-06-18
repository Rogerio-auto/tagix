import type { CalendarMember, CalendarRow } from '../types';

export interface RailCalendar {
  readonly calendar: CalendarRow;
  /** Nome a exibir (para "Pessoas", o nome do dono em vez do nome do calendário). */
  readonly label: string;
}

export interface RailGroup {
  readonly id: 'mine' | 'company' | 'teams' | 'people';
  readonly title: string;
  readonly items: readonly RailCalendar[];
}

/**
 * Agrupa os calendários acessíveis nos grupos da trilha (CALENDAR_V2_PLAN §4):
 *   • Meu calendário — o pessoal do próprio membro
 *   • Empresa        — os workspace
 *   • Times          — os de time
 *   • Pessoas        — (OWNER/ADMIN) o pessoal dos OUTROS membros
 *
 * A visibilidade já foi escopada pela API (`canAccessCalendar`); aqui só organizamos.
 */
export function buildRailGroups(input: {
  calendars: readonly CalendarRow[];
  members: readonly CalendarMember[];
  myMemberId: string | undefined;
  canSeeOthers: boolean;
}): RailGroup[] {
  const { calendars, members, myMemberId, canSeeOthers } = input;
  const memberName = new Map(members.map((m) => [m.id, m.name?.trim() || m.email] as const));

  const mine: RailCalendar[] = [];
  const company: RailCalendar[] = [];
  const teams: RailCalendar[] = [];
  const people: RailCalendar[] = [];

  for (const c of calendars) {
    if (c.type === 'workspace') {
      company.push({ calendar: c, label: c.name });
    } else if (c.type === 'team') {
      teams.push({ calendar: c, label: c.name });
    } else {
      // personal
      if (c.ownerId && c.ownerId === myMemberId) {
        mine.push({ calendar: c, label: 'Meu calendário' });
      } else if (canSeeOthers) {
        const owner = c.ownerId ? memberName.get(c.ownerId) : null;
        people.push({ calendar: c, label: owner ?? c.name });
      }
    }
  }

  const sortByLabel = (a: RailCalendar, b: RailCalendar): number =>
    a.label.localeCompare(b.label, 'pt-BR');
  company.sort(sortByLabel);
  teams.sort(sortByLabel);
  people.sort(sortByLabel);

  const groups: RailGroup[] = [];
  if (mine.length > 0) groups.push({ id: 'mine', title: 'Meu calendário', items: mine });
  if (company.length > 0) groups.push({ id: 'company', title: 'Empresa', items: company });
  if (teams.length > 0) groups.push({ id: 'teams', title: 'Times', items: teams });
  if (people.length > 0) groups.push({ id: 'people', title: 'Pessoas', items: people });
  return groups;
}
