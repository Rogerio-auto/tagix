import { ThemePair } from '../lib/ThemePair';
import { ArrowRight } from 'lucide-react';
import { Button } from './Button';

export const Variants = () => (
  <div className="flex flex-wrap gap-3">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="link">Link</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap gap-3">
    <Button>Default</Button>
    <Button disabled>Disabled</Button>
    <Button loading>Loading</Button>
    <Button rightIcon={<ArrowRight className="size-4" />}>Com ícone</Button>
  </div>
);

/** Matriz de estados x variantes nos dois temas (DoD: default/hover/focus/loading/disabled). */
export const BothThemes = () => (
  <ThemePair>
    <div className="flex flex-col gap-4">
      {(['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'] as const).map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <Button variant={variant}>{variant}</Button>
          <Button variant={variant} loading>
            loading
          </Button>
          <Button variant={variant} disabled>
            disabled
          </Button>
        </div>
      ))}
    </div>
  </ThemePair>
);

/** Foco de teclado forçado visível para revisão (o real aparece com Tab). */
export const FocusRing = () => (
  <div className="flex gap-3">
    <Button className="shadow-glow-md">Primary</Button>
    <Button variant="secondary" className="shadow-glow-md">
      Secondary
    </Button>
  </div>
);
