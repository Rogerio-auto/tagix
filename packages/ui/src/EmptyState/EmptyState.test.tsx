import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { EmptyState } from './EmptyState';

describe('EmptyState — contrato', () => {
  it('renderiza título como heading e mantém o ícone decorativo (aria-hidden)', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Sem conversas" />);
    expect(screen.getByRole('heading', { name: 'Sem conversas' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exibe CTA acionável quando fornecido (UX §2.6)', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Sem conversas"
        action={<button type="button">Conectar canal</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Conectar canal' })).toBeInTheDocument();
  });

  it('não renderiza a área de ação quando não há CTA', () => {
    render(<EmptyState icon={Inbox} title="Vazio" description="nada aqui" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
