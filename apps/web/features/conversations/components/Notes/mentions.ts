/**
 * Utilitários de menção (`@member`) para notas internas (F1-S22).
 *
 * O editor é um textarea simples: o usuário digita `@nome`. Na submissão,
 * resolvemos os tokens `@token` contra a lista de membros do workspace para
 * materializar os ids mencionados. O backend revalida (só membros existentes
 * permanecem) — aqui é apenas a melhor resolução possível no client.
 */
import type { MentionableMember } from './types';

/** Rótulo de menção de um membro (nome, com fallback para o local-part do email). */
export function memberHandle(member: MentionableMember): string {
  const base = member.name?.trim() || member.email.split('@')[0] || member.email;
  // Handle sem espaços (ex.: "Ana Paula" → "ana_paula") para casar com `@token`.
  return base.toLowerCase().replace(/\s+/g, '_');
}

/** Rótulo de exibição de um membro (nome ou email). */
export function memberLabel(member: MentionableMember): string {
  return member.name?.trim() || member.email;
}

/**
 * Extrai os ids de membros mencionados no corpo. Casa cada `@token` contra o
 * handle do membro; tokens sem correspondência são ignorados (texto livre).
 */
export function resolveMentions(body: string, members: readonly MentionableMember[]): string[] {
  if (members.length === 0) return [];
  const byHandle = new Map(members.map((m) => [memberHandle(m), m.id]));
  const ids = new Set<string>();
  const re = /@([a-z0-9_]+)/gi;
  for (const match of body.matchAll(re)) {
    const token = match[1]?.toLowerCase();
    if (!token) continue;
    const id = byHandle.get(token);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Detecta um gatilho de autocomplete `@` na posição do cursor: retorna o termo
 * parcial após o último `@` da palavra atual, ou `null` se não há gatilho ativo.
 */
export function activeMentionQuery(value: string, caret: number): string | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // O `@` deve iniciar palavra (começo ou precedido por espaço/quebra).
  const prev = at > 0 ? upto[at - 1] : ' ';
  if (prev && !/\s/.test(prev)) return null;
  const term = upto.slice(at + 1);
  // Termo só pode conter caracteres de handle; espaço encerra o gatilho.
  if (/[^a-z0-9_]/i.test(term)) return null;
  return term;
}

/** Substitui o termo `@parcial` no cursor pelo handle completo do membro escolhido. */
export function applyMention(
  value: string,
  caret: number,
  member: MentionableMember,
): { next: string; caret: number } {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return { next: value, caret };
  const handle = `@${memberHandle(member)} `;
  const next = value.slice(0, at) + handle + value.slice(caret);
  return { next, caret: at + handle.length };
}
