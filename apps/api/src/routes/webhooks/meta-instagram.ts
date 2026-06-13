/**
 * Roteamento/inspeção do payload Instagram na borda do webhook (F15-S02,
 * INSTAGRAM.md §4). A borda permanece magra: verify signature -> dedup ->
 * publish (compartilhado com WhatsApp em `meta.ts`). Este módulo isola o que é
 * específico de IG: reconhecer o envelope `object:'instagram'`, resolver o
 * `igUserId` alvo (entry.id) e sumarizar os eventos para log/observability sem
 * fazer o parse de domínio (isso é do adapter/worker-inbound).
 *
 * NÃO re-implementa signature/dedup/event-id (são compartilhados e ficam em
 * `meta.ts`/`signature.ts`/`event-id.ts`). Sem `any`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `true` se o envelope é do objeto Instagram. */
export function isInstagramEnvelope(body: unknown): boolean {
  return isRecord(body) && body['object'] === 'instagram';
}

/** Categorias de evento IG reconhecidas na borda (para métrica/log). */
export type IgEdgeEventKind =
  | 'dm'
  | 'story_mention'
  | 'story_reply'
  | 'share'
  | 'postback'
  | 'reaction'
  | 'seen'
  | 'referral'
  | 'comment'
  | 'mention'
  | 'unknown';

export interface IgEdgeSummary {
  /** `igUserId` alvo (entry.id) — usado pelo worker para resolver o channel. */
  readonly igUserIds: readonly string[];
  /** Contagem por tipo de evento (observability `hm.ig.messages.received`). */
  readonly counts: Readonly<Record<IgEdgeEventKind, number>>;
  /** Total de eventos reconhecidos. */
  readonly total: number;
}

function classifyMessaging(m: Record<string, unknown>): IgEdgeEventKind {
  const message = isRecord(m['message']) ? m['message'] : undefined;
  if (message) {
    const attachments = asArray(message['attachments']).filter(isRecord);
    if (attachments.some((a) => asString(a['type']) === 'story_mention')) return 'story_mention';
    if (attachments.some((a) => asString(a['type']) === 'share')) return 'share';
    const replyTo = isRecord(message['reply_to']) ? message['reply_to'] : undefined;
    if (replyTo && isRecord(replyTo['story'])) return 'story_reply';
    return 'dm';
  }
  if (isRecord(m['postback'])) return 'postback';
  if (isRecord(m['reaction'])) return 'reaction';
  if (isRecord(m['read'])) return 'seen';
  if (isRecord(m['referral'])) return 'referral';
  return 'unknown';
}

function emptyCounts(): Record<IgEdgeEventKind, number> {
  return {
    dm: 0,
    story_mention: 0,
    story_reply: 0,
    share: 0,
    postback: 0,
    reaction: 0,
    seen: 0,
    referral: 0,
    comment: 0,
    mention: 0,
    unknown: 0,
  };
}

/**
 * Sumariza um envelope IG já autenticado: quais igUserIds e quantos eventos de
 * cada tipo. Tolerante a shape — entries/messaging/changes ausentes contam 0.
 */
export function summarizeInstagramEnvelope(body: unknown): IgEdgeSummary {
  const counts = emptyCounts();
  const igUserIds = new Set<string>();
  let total = 0;

  if (!isRecord(body)) {
    return { igUserIds: [], counts, total: 0 };
  }

  for (const entry of asArray(body['entry'])) {
    if (!isRecord(entry)) continue;
    const entryId = asString(entry['id']);
    if (entryId !== undefined) igUserIds.add(entryId);

    for (const m of asArray(entry['messaging'])) {
      if (!isRecord(m)) continue;
      const message = isRecord(m['message']) ? m['message'] : undefined;
      // Echoes/deletes não são eventos inbound — não contam.
      if (message && (message['is_echo'] === true || message['is_deleted'] === true)) continue;
      counts[classifyMessaging(m)] += 1;
      total += 1;
    }

    for (const c of asArray(entry['changes'])) {
      if (!isRecord(c)) continue;
      const field = asString(c['field']);
      if (field === 'comments') {
        counts.comment += 1;
        total += 1;
      } else if (field === 'mentions') {
        counts.mention += 1;
        total += 1;
      }
    }
  }

  return { igUserIds: [...igUserIds], counts, total };
}
