/**
 * Regra de "humano respondeu" aplicada ao eco do app (F70-S04).
 *
 * Quando o dono do número responde pelo celular (WhatsApp Business em
 * coexistência, ou o app do Instagram), o Leadium precisa tratar essa mensagem
 * exatamente como trata a resposta de um atendente pela UI:
 *
 * - `ai_mode='on'`  → `paused`, `ai_paused_reason='human_takeover'`,
 *   `ai_paused_at`, `ai_paused_by=<membro>`, `ai_last_human_at`.
 * - `paused`/`off`  → só registra a atividade humana (`ai_last_human_at`); nunca
 *   regride (paused não vira on, off não muda).
 * - `first_response_at` só é gravado se ainda for nulo (nunca vira "última
 *   resposta").
 *
 * É a MESMA regra de `apps/api/src/routes/conversations/messages.ts` (F30-S04 +
 * F55-S02). Ela vive duplicada aqui porque o worker não pode importar o grafo da
 * API (builds separados) e o pacote comum (`@hm/shared`) está fora da fronteira
 * deste slot — a extração para lá é o próximo passo natural (ver relatório do
 * slot). Enquanto isso, esta função é pura e coberta por teste, para que a
 * divergência apareça no diff e não em produção.
 *
 * Duas diferenças deliberadas em relação à rota da API, ambas por o eco ser
 * assíncrono (pode chegar atrasado ou ser reentregue):
 *
 * 1. O instante usado é o do eco (`at`, horário do provider), não `now()` do
 *    servidor — é quando o humano de fato respondeu.
 * 2. `ai_last_human_at` só avança: um eco atrasado não pode puxar a última
 *    atividade humana para trás (a ociosidade da IA é calculada a partir dela).
 */

/** Estado da conversa lido (sob lock) antes de aplicar a regra. */
export interface ConversationHumanState {
  /** `text` no banco; o check constraint garante `'off'|'on'|'paused'`. */
  readonly aiMode: string;
  readonly firstResponseAt: Date | null;
  readonly aiLastHumanAt: Date | null;
}

export interface HumanReplyInput {
  /** Membro autor da resposta (dono do canal). `null` quando não resolvido. */
  readonly memberId: string | null;
  /** Instante da resposta (horário do provider). */
  readonly at: Date;
  /**
   * Se esta mensagem conta como "primeira resposta". Falso quando a conversa foi
   * aberta por este próprio eco (prospecção): ninguém perguntou nada ainda, então
   * não há o que "responder" — gravar aqui zeraria artificialmente o tempo de
   * primeira resposta das métricas de SLA.
   */
  readonly countsAsResponse: boolean;
}

/** Colunas de `conversations` alteradas pela regra (subconjunto de `set`). */
export interface HumanReplyPatch {
  aiMode?: 'paused';
  aiPausedReason?: 'human_takeover';
  aiPausedAt?: Date;
  aiPausedBy?: string | null;
  aiLastHumanAt?: Date;
  firstResponseAt?: Date;
}

export interface HumanReplyPlan {
  readonly patch: HumanReplyPatch;
  /** `true` quando a IA acabou de ser pausada (dispara `conversation:ai_mode_changed`). */
  readonly paused: boolean;
}

/** Calcula o patch da conversa para uma resposta humana. Pura e determinística. */
export function planHumanReply(
  state: ConversationHumanState,
  input: HumanReplyInput,
): HumanReplyPlan {
  const patch: HumanReplyPatch = {};

  if (state.aiLastHumanAt === null || input.at.getTime() > state.aiLastHumanAt.getTime()) {
    patch.aiLastHumanAt = input.at;
  }

  if (input.countsAsResponse && state.firstResponseAt === null) {
    patch.firstResponseAt = input.at;
  }

  if (state.aiMode === 'on') {
    patch.aiMode = 'paused';
    patch.aiPausedReason = 'human_takeover';
    patch.aiPausedAt = input.at;
    patch.aiPausedBy = input.memberId;
    return { patch, paused: true };
  }

  return { patch, paused: false };
}
