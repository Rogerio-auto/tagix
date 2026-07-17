import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

describe('IconButton — contrato a11y', () => {
  it('expõe nome acessível via aria-label e mantém o ícone decorativo', () => {
    const { container } = render(<IconButton aria-label="Fechar" icon={<X />} />);
    const btn = screen.getByRole('button', { name: 'Fechar' });
    expect(btn).toHaveAccessibleName('Fechar');
    // O ícone é decorativo: fica sob um wrapper aria-hidden (não polui o nome).
    const wrapper = container.querySelector('span[aria-hidden="true"]');
    expect(wrapper?.querySelector('svg')).not.toBeNull();
  });

  it('aplica a classe de foco de teclado visível (focus-visible:shadow-glow-md)', () => {
    render(<IconButton aria-label="Editar" icon={<X />} />);
    expect(screen.getByRole('button')).toHaveClass('focus-visible:shadow-glow-md');
  });

  it('dispara onClick ao clicar', () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="Ação" icon={<X />} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('bloqueia o clique e marca aria-busy quando loading (UX §2.7)', () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="Salvando" icon={<X />} loading onClick={onClick} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
