import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, StatusPill } from './Badge';

describe('Badge / StatusPill — contrato', () => {
  it('o significado é o texto; o ponto é decorativo (aria-hidden)', () => {
    const { container } = render(<StatusPill tone="danger">Bloqueado</StatusPill>);
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(container.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
  });

  it('Badge sem dot/live não renderiza ponto', () => {
    const { container } = render(<Badge>Rascunho</Badge>);
    expect(container.querySelector('i')).toBeNull();
  });

  it('live liga o Signal pulse apenas sob motion-safe (reduced-motion fica estático)', () => {
    const { container } = render(
      <Badge tone="brand" live>
        Ao vivo
      </Badge>,
    );
    const dot = container.querySelector('i');
    expect(dot).toHaveAttribute('data-live', 'true');
    expect(dot?.className).toContain('motion-safe:animate-[hm-signal');
    expect(dot?.className).not.toMatch(/(^|\s)animate-/);
  });

  it('dot sem live nunca pulsa (movimento contínuo só em estado vivo)', () => {
    const { container } = render(<Badge dot>Rascunho</Badge>);
    expect(container.querySelector('i')?.className).not.toContain('animate');
  });

  it('StatusPill sempre mostra o ponto', () => {
    const { container } = render(<StatusPill>Revisão</StatusPill>);
    expect(container.querySelector('i')).not.toBeNull();
  });
});
