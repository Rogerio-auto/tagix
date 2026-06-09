import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** CTA primário ÚNICO (UX §2.6 / DS §10.3) — passe um <Button variant="primary">. */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Icon className="size-12 text-text-low" aria-hidden />
      <h2 className="font-head text-2xl font-semibold text-text">{title}</h2>
      {description && <p className="max-w-md font-body text-text-mid">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
