/**
 * Repositório de valores personalizados (F59-S07 — AGENCIA_PLAN.md §3.4).
 *
 * Toda função roda sob a transação recebida, ou seja, sob RLS.
 *
 * O resolver (`resolveCustomValues`) é **puro** e vive separado do I/O: recebe o
 * mapa já carregado. Assim quem renderiza um flow, um prompt ou um e-mail
 * carrega o mapa uma vez e substitui N textos sem N consultas.
 */
import { and, eq } from 'drizzle-orm';
import type { DbTx } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import {
  workspaceCustomValues,
  type CustomValueKind,
  type WorkspaceCustomValue,
} from '../schema/custom_values';

/** Valor como a API o expõe: `secret` nunca carrega o conteúdo. */
export interface CustomValueView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly kind: CustomValueKind;
  readonly description: string | null;
  /** `null` quando `kind = 'secret'` — o valor não sai daqui. */
  readonly value: string | null;
  /** Para `secret`: diz se há valor guardado, sem revelá-lo. */
  readonly hasValue: boolean;
}

export interface UpsertCustomValueInput {
  readonly workspaceId: string;
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly kind: CustomValueKind;
  readonly description?: string | null;
}

/** Resultado da resolução de um texto. */
export interface ResolveResult {
  readonly text: string;
  /** Chaves referenciadas que não existem no workspace. */
  readonly unresolved: readonly string[];
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{1,48})\s*\}\}/g;

/**
 * Substitui `{{chave}}` pelos valores do mapa.
 *
 * **Não é recursivo por decisão de segurança**, não por simplicidade: o valor é
 * controlado pelo usuário e vai parar dentro de prompt de agente. Expandir
 * `{{a}}` cujo conteúdo contém `{{b}}` abriria caminho de injeção e de laço.
 *
 * Chave desconhecida fica **intacta** no texto e é reportada. Apagar
 * silenciosamente produziria mensagem quebrada que ninguém percebe — "Olá, ,
 * tudo bem?" sai sem erro nenhum.
 */
export function resolveCustomValues(
  text: string,
  values: ReadonlyMap<string, string>,
): ResolveResult {
  const unresolved: string[] = [];
  const out = text.replace(PLACEHOLDER, (match, key: string) => {
    const v = values.get(key);
    if (v === undefined) {
      if (!unresolved.includes(key)) unresolved.push(key);
      return match;
    }
    return v;
  });
  return { text: out, unresolved };
}

function toView(row: WorkspaceCustomValue): CustomValueView {
  const isSecret = row.kind === 'secret';
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    kind: row.kind,
    description: row.description,
    value: isSecret ? null : row.value,
    hasValue: row.value.length > 0,
  };
}

export const customValuesRepo = {
  /** Lista para a UI de configuração. Secrets vêm sem valor. */
  async list(tx: DbTx, workspaceId: string): Promise<CustomValueView[]> {
    const rows = await tx
      .select()
      .from(workspaceCustomValues)
      .where(eq(workspaceCustomValues.workspaceId, workspaceId));
    return rows.map(toView);
  },

  /**
   * Mapa `chave → valor decifrado`, para renderização.
   *
   * Este é o único caminho que expõe o conteúdo de um `secret`, e ele existe
   * para o motor de renderização — não para a API.
   */
  async resolveMap(tx: DbTx, workspaceId: string): Promise<Map<string, string>> {
    const rows = await tx
      .select()
      .from(workspaceCustomValues)
      .where(eq(workspaceCustomValues.workspaceId, workspaceId));

    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.key, r.kind === 'secret' ? decryptSecret(r.value) : r.value);
    }
    return map;
  },

  /** Cria ou atualiza pelo par `(workspace, chave)`. */
  async upsert(tx: DbTx, input: UpsertCustomValueInput): Promise<void> {
    const stored = input.kind === 'secret' ? encryptSecret(input.value) : input.value;
    const now = new Date();
    await tx
      .insert(workspaceCustomValues)
      .values({
        workspaceId: input.workspaceId,
        key: input.key,
        label: input.label,
        value: stored,
        kind: input.kind,
        description: input.description ?? null,
      })
      .onConflictDoUpdate({
        target: [workspaceCustomValues.workspaceId, workspaceCustomValues.key],
        set: {
          label: input.label,
          value: stored,
          kind: input.kind,
          description: input.description ?? null,
          updatedAt: now,
        },
      });
  },

  async remove(tx: DbTx, workspaceId: string, key: string): Promise<void> {
    // `and()` do Drizzle, nao `&&` do JS: `&&` devolveria so a segunda condicao
    // e apagaria a chave em QUALQUER workspace. A RLS ainda seguraria, mas
    // depender dela para corrigir um bug de query e sorte, nao desenho.
    await tx
      .delete(workspaceCustomValues)
      .where(
        and(
          eq(workspaceCustomValues.workspaceId, workspaceId),
          eq(workspaceCustomValues.key, key),
        ),
      );
  },
};
