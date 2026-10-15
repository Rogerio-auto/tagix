import { StatusPill, type BadgeTone } from '@hm/ui';
import { templateStatus } from './format';
import type { MessageTemplate } from './types';

/** Tom da apresentação do status → tom do `StatusPill` do DS 3.0 (F72-S07). */
const TONE = {
  success: 'success',
  warn: 'warning',
  danger: 'danger',
  neutral: 'neutral',
} as const satisfies Record<string, BadgeTone>;

export function TemplateStatusBadge({ template }: { template: Pick<MessageTemplate, 'status' | 'isAvailable'> }) {
  const presentation = templateStatus(template);
  return (
    <StatusPill tone={TONE[presentation.tone]} size="sm">
      {presentation.label}
    </StatusPill>
  );
}
