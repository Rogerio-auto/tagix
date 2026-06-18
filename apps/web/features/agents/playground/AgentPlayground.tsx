'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RotateCcw, Send, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@hm/ui';
import { KbCitation } from '@/features/knowledge/feedback';
import { useAgentPlaygroundStream } from './useAgentPlaygroundStream';
import type { PlaygroundError, SseUsage, ToolCallView, TranscriptTurn } from './types';

/**
 * Playground do agente (F2-S19, AGENTS_LANGGRAPH §10, UX §2/§3).
 *
 * Chat de teste contra o agente: o usuário envia um turno, a API faz proxy do
 * stream SSE do runtime e os tokens/tool calls/final renderizam ao vivo. **Não
 * cria conversas/mensagens reais** — a API envia `is_playground: true`, então as
 * tools de negócio simulam e o usage é marcado `playground=true`. Respeita
 * policy + cost-guard (a API emite `budget_exceeded`/`model_blocked` quando aplicável).
 *
 * DS v2 (tokens semânticos, zero hex). Acessível: transcript `aria-live="polite"`,
 * cursor de streaming, erro 3-partes com ref copiável.
 */
export function AgentPlayground({ agentId }: { agentId: string }) {
  const { turns, isStreaming, error, send, reset } = useAgentPlaygroundStream(agentId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o fim conforme tokens chegam.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, isStreaming, error]);

  const submit = () => {
    if (draft.trim().length === 0 || isStreaming) return;
    send(draft);
    setDraft('');
  };

  const isEmpty = turns.length === 0 && !error;

  return (
    // Mobile: ocupa mais altura útil (dvh) para o chat caber na mão; desktop:
    // clamp original. A altura é só dimensionamento (aparência) — sem troca de
    // estrutura — então fica em classes responsivas. — MOBILE_UX §2 (canvas/chat).
    <div className="flex h-[clamp(26rem,72dvh,40rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface-2 md:h-[clamp(28rem,60vh,44rem)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="font-head text-sm font-semibold text-text">Playground</span>
          <span className="hidden truncate font-body text-xs text-text-low sm:inline">
            testes não afetam conversas reais
          </span>
        </div>
        {turns.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={isStreaming}
            leftIcon={<RotateCcw className="size-3.5" aria-hidden />}
          >
            Limpar
          </Button>
        )}
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-busy={isStreaming || undefined}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {isEmpty ? (
          <EmptyHint />
        ) : (
          turns.map((turn) => <TurnBubble key={turn.id} turn={turn} agentId={agentId} />)
        )}
        {error && <ErrorPanel error={error} />}
      </div>

      {/* Composer */}
      <div className="border-t border-border-2 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Escreva uma mensagem para testar o agente…"
            aria-label="Mensagem para o agente"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-border bg-surface-inset px-3 py-2 font-body text-sm text-text outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-text-low hover:border-border-2 focus-visible:border-brand focus-visible:shadow-glow-md"
          />
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            loading={isStreaming}
            disabled={draft.trim().length === 0}
            leftIcon={isStreaming ? undefined : <Send className="size-4" aria-hidden />}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

function EmptyHint() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-inset text-text-mid">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <p className="font-head text-sm font-medium text-text-mid">Teste seu agente ao vivo</p>
      <p className="max-w-xs font-body text-xs text-text-low">
        Envie uma mensagem para ver o agente responder em tempo real, com as tools e o modelo
        configurados — sem criar uma conversa real.
      </p>
    </div>
  );
}

function TurnBubble({ turn, agentId }: { turn: TranscriptTurn; agentId: string }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-br-sm bg-brand px-3.5 py-2 font-body text-sm text-text-on-brand">
          {turn.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {turn.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {turn.toolCalls.map((c) => (
            <ToolChip key={c.id} call={c} />
          ))}
        </div>
      )}
      <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-surface-3 px-3.5 py-2 font-body text-sm text-text">
        {turn.text.length > 0 ? (
          <span className="whitespace-pre-wrap">{turn.text}</span>
        ) : (
          turn.streaming && <span className="text-text-low">pensando…</span>
        )}
        {turn.streaming && turn.text.length > 0 && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-text-mid align-middle"
          />
        )}
      </div>
      {turn.usage && <UsageLine usage={turn.usage} />}
      {turn.citations.length > 0 && (
        <div className="mt-1 flex max-w-[85%] flex-col gap-1">
          <span className="font-head text-xs font-medium text-text-low">Fontes consultadas</span>
          {turn.citations.map((citation) => (
            <KbCitation
              key={`${citation.documentId}:${citation.chunkId ?? 'doc'}`}
              citation={citation}
              agentId={agentId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolChip({ call }: { call: ToolCallView }) {
  const done = call.status === 'done';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-inset px-2 py-0.5 font-head text-xs font-medium text-text-mid"
      title={done && call.durationMs !== undefined ? `${call.durationMs} ms` : 'executando…'}
    >
      <Wrench className={done ? 'size-3 text-success' : 'size-3 animate-pulse text-brand'} aria-hidden />
      {call.toolKey}
      {done && call.durationMs !== undefined && (
        <span className="font-price text-text-low">{call.durationMs}ms</span>
      )}
    </span>
  );
}

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const int = new Intl.NumberFormat('pt-BR');

function UsageLine({ usage }: { usage: SseUsage }) {
  const totalTokens = usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens;
  return (
    <p className="pl-1 font-price text-xs text-text-low">
      {int.format(totalTokens)} tokens · {usd.format(usage.total_cost_usd)}
    </p>
  );
}

function ErrorPanel({ error }: { error: PlaygroundError }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!error.reference) return;
    await navigator.clipboard.writeText(error.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="alert"
      className="rounded-md border border-danger bg-surface-inset px-3.5 py-3 font-body text-sm"
    >
      <p className="font-head font-semibold text-danger">{error.title}</p>
      {error.reason && <p className="mt-1 text-text-mid">{error.reason}</p>}
      {error.reference && (
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm font-price text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          Ref: {error.reference}
        </button>
      )}
    </div>
  );
}
