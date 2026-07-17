'use client';

import { useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { diffLines, diffStats } from './diff';
import type { PromptVersion } from './types';

/**
 * Renderiza o diff linha-a-linha entre dois prompts (F56-S31). Estilo "unified":
 * linhas removidas (`del`) em vermelho, adicionadas (`add`) em verde, iguais neutras.
 * Colunas de numeração left/right para orientação. DS v2 — só tokens semânticos.
 */
export function VersionDiff({ from, to }: { from: PromptVersion; to: PromptVersion }) {
  const lines = useMemo(() => diffLines(from.systemPrompt, to.systemPrompt), [from, to]);
  const stats = useMemo(() => diffStats(lines), [lines]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-xs text-text-low">
        <span>
          Comparando <span className="font-price text-text-mid">v{from.version}</span> →{' '}
          <span className="font-price text-text-mid">v{to.version}</span>
        </span>
        <span className="text-success">+{stats.added} adicionadas</span>
        <span className="text-danger">-{stats.removed} removidas</span>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface-inset">
        <div className="max-h-[28rem] overflow-auto font-price text-xs leading-relaxed">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                'flex items-start gap-3 px-3 py-0.5',
                line.type === 'add' && 'bg-success/10',
                line.type === 'del' && 'bg-danger/10',
              )}
            >
              <span className="w-8 shrink-0 select-none text-right text-text-low/60">
                {line.leftNo ?? ''}
              </span>
              <span className="w-8 shrink-0 select-none text-right text-text-low/60">
                {line.rightNo ?? ''}
              </span>
              <span
                className={cn(
                  'w-3 shrink-0 select-none text-center',
                  line.type === 'add' && 'text-success',
                  line.type === 'del' && 'text-danger',
                  line.type === 'eq' && 'text-text-low/40',
                )}
              >
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ''}
              </span>
              <span
                className={cn(
                  'whitespace-pre-wrap break-words',
                  line.type === 'add' && 'text-text',
                  line.type === 'del' && 'text-text-mid line-through decoration-danger/40',
                  line.type === 'eq' && 'text-text-low',
                )}
              >
                {line.text || ' '}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
