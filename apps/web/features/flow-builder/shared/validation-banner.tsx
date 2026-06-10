'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FlowValidationIssue } from '@hm/flow-engine/validation';
import { cn } from '@/shared/lib/cn';

/**
 * Banner de validacao pre-publish (FLOW_BUILDER secao 9.3). Estado 3-partes: o que aconteceu,
 * por que, e qual node corrigir. Usa `validateFlow` de @hm/flow-engine (pura, client-side).
 */
export function ValidationBanner({
  issues,
  onFocusNode,
}: {
  issues: readonly FlowValidationIssue[];
  onFocusNode?: (nodeId: string) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
        <CheckCircle2 className="size-4" aria-hidden />
        Flow valido — pronto para publicar.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        errors.length > 0
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" aria-hidden />
        {errors.length > 0
          ? `${errors.length} erro(s) impedem a publicacao`
          : `${warnings.length} aviso(s)`}
      </div>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="flex items-start gap-1.5">
            <span className="text-text-low">•</span>
            <span>
              {issue.message}
              {issue.nodeId && onFocusNode && (
                <button
                  type="button"
                  className="ml-1 underline underline-offset-2 hover:opacity-80"
                  onClick={() => onFocusNode(issue.nodeId as string)}
                >
                  ver node
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
