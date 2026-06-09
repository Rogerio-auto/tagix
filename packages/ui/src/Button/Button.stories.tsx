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
