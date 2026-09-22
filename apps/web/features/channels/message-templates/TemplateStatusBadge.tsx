import { cn } from '@/shared/lib/cn';
import { templateStatus } from './format';
import type { MessageTemplate } from './types';

const TONE = {
  success: 'bg-success/15 text-success',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-surface-3 text-text-mid',
} as const;

export function TemplateStatusBadge({ template }: { template: Pick<MessageTemplate, 'status' | 'isAvailable'> }) {
  const presentation = templateStatus(template);
  return (
    <span className={cn('inline-flex rounded-pill px-2.5 py-1 font-head text-xs font-medium', TONE[presentation.tone])}>
      {presentation.label}
    </span>
  );
}
