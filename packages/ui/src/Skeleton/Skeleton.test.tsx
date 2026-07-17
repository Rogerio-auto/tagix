import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonCard, SkeletonText } from './Skeleton';

describe('Skeleton — contrato', () => {
  it('base é decorativa (aria-hidden) e desliga a animação com prefers-reduced-motion', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
  });

  it('SkeletonText anuncia carregamento (role=status, aria-busy) e respeita o número de linhas', () => {
    const { container } = render(<SkeletonText lines={5} label="Carregando texto" />);
    const status = screen.getByRole('status', { name: 'Carregando texto' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5);
  });

  it('SkeletonText garante ao menos uma linha mesmo com lines<=0', () => {
    const { container } = render(<SkeletonText lines={0} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('SkeletonCard expõe status e some com a mídia quando media=false', () => {
    const { rerender, container } = render(<SkeletonCard label="Carregando card" />);
    expect(screen.getByRole('status', { name: 'Carregando card' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    const withMedia = container.querySelectorAll('[aria-hidden="true"]').length;
    rerender(<SkeletonCard media={false} label="Carregando card" />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeLessThan(withMedia);
  });
});
