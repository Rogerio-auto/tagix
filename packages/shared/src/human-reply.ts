/**
 * Regra de "humano respondeu" (F30-S04 + F55-S02; unificada na F70-S07).
 *
 * Toda resposta humana numa conversa — o atendente pela UI (`POST
 * /conversations/:id/messages`) ou o dono do número pelo celular (eco do
 * WhatsApp Business em coexistência / eco do app do Instagram, F70-S04) — aplica
 * a MESMA regra. Antes da F70-S07 ela vivia duplicada na API e no worker; agora
 * as duas pontas chamam esta função, então não há como divergir.
 *
 * - `ai_mode='on'`  → `paused`, `ai_paused_reason='human_takeover'`,
 *   `ai_paused_at`, `ai_paused_by=<membro>`, `ai_last_human_at`.
 * - `paused`/`off`  → só registra a atividade humana (`ai_last_human_at`); nunca
 *   regride (paused não vira on, off não muda).
 * - `first_response_at` só é gravado se ainda for nulo (nunca vira "última
 *   resposta").
 *
 * `ai_last_human_at` só avança: um eco atrasado/reentregue não pode puxar a
 * última atividade humana para trás (a ociosidade da IA é calculada a partir
 * dela). Para a UI, `at = now()`, então a regra coincide com o "sempre grava".
 *
 * Pura e determinística: quem chama lê o estado (de preferência sob `FOR
 * UPDATE`) e aplica o `patch` na mesma transação.
 */

/** Estado da conversa lido antes de aplicar a regra. */
export interface ConversationHumanState {
  /** `text` no banco; o check constraint garante `'off'|'on'|'paused'`. */
  readonly aiMode: string;
  /**
   * `first_response_at` atual. Quem NÃO leu a coluna passa `null` e protege a
   * escrita no SQL (`coalesce(first_response_at, …)`), como faz a rota da API.
   */
  readonly firstResponseAt: Date | null;
  /** `ai_last_human_at` atual (`null` = não lido ou nunca houve humano). */
  readonly aiLastHumanAt: Date | null;
}

export interface HumanReplyInput {
  /** Membro autor da resposta. `null` quando não resolvido. */
  readonly memberId: string | null;
  /** Instante da resposta (UI: agora; eco: horário do provider). */
  readonly at: Date;
  /**
   * Se esta mensagem conta como "primeira resposta". Falso quando a conversa foi
   * aberta por esta própria mensagem do negócio (prospecção): ninguém perguntou
   * nada ainda — gravar aqui zeraria artificialmente o tempo de primeira
   * resposta das métricas de SLA.
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
