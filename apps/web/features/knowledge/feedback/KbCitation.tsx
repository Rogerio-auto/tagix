'use client';

import { useState } from 'react';
import { FileText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useSubmitKbFeedback } from './queries';
import type { Citation } from './types';

type Vote = 'up' | 'down' | null;

/**
 * Citação de KB com marcação util/nao-util (F3-S07). Affordance discreta sob a
 * resposta do agente (UX §3: micro-feedback, sem toast intrusivo; idempotente —
 * re-clicar nao duplica visualmente). Persiste em kb_feedback.
 */
export function KbCitation({
  citation,
  agentId,
  conversationId,
}: {
  citation: Citation;
  agentId?: string;
  conversationId?: string;
}) {
  const submit = useSubmitKbFeedback();
  const [vote, setVote] = useState<Vote>(null);

  const mark = (helpful: boolean) => {
    const next: Vote = helpful ? 'up' : 'down';
    if (vote === next || submit.isPending) return; // idempotente
    setVote(next);
    submit.mutate(
      {
        documentId: citation.documentId,
        chunkId: citation.chunkId,
        agentId: agentId ?? null,
        conversationId: conversationId ?? null,
        helpful,
      },
      {
        // Reverte o estado visual se a persistencia falhar (honesto).
        onError: () => setVote(null),
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border-2 bg-surface-inset px-2.5 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5 font-body text-xs text-text-mid">
        <FileText className="size-3.5 shrink-0 text-text-low" aria-hidden />
        <span className="truncate">{citation.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <VoteButton
          active={vote === 'up'}
          label="Marcar citação como útil"
          onClick={() => mark(true)}
          tone="up"
        >
          <ThumbsUp className="size-3.5" aria-hidden />
        </VoteButton>
        <VoteButton
          active={vote === 'down'}
          label="Marcar citação como não-útil"
          onClick={() => mark(false)}
          tone="down"
        >
          <ThumbsDown className="size-3.5" aria-hidden />
        </VoteButton>
      </span>
    </div>
  );
}

function VoteButton({
  active,
  tone,
  label,
  onClick,
  children,
}: {
  active: boolean;
  tone: 'up' | 'down';
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex size-6 items-center justify-center rounded-sm outline-none transition-colors duration-200',
        'focus-visible:shadow-glow-sm',
        active
          ? tone === 'up'
            ? 'bg-success/15 text-success'
            : 'bg-danger/15 text-danger'
          : 'text-text-low hover:bg-surface-3 hover:text-text-mid',
      )}
    >
      {children}
    </button>
  );
}
