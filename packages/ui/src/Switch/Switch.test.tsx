import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './Switch';

describe('Switch — contrato a11y e teclado', () => {
  it('é role=switch com aria-checked e nome pelo rótulo visível', () => {
    render(<Switch label="Notificações" defaultChecked />);
    const sw = screen.getByRole('switch', { name: 'Notificações' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('não controlado: alterna ao clicar e chama onCheckedChange', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Agente ativo" onCheckedChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Agente ativo' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('controlado: o estado só muda pelo pai', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="X" checked={false} onCheckedChange={onChange} />);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('clicar no rótulo alterna (alvo maior)', () => {
    render(<Switch label="Receber e-mails" />);
    fireEvent.click(screen.getByText('Receber e-mails'));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('é um button nativo: Espaço e Enter alternam via click (teclado)', () => {
    render(<Switch aria-label="K" />);
    const sw = screen.getByRole('switch');
    expect(sw.tagName).toBe('BUTTON');
    expect(sw).toHaveAttribute('type', 'button');
  });

  it('disabled e loading bloqueiam o clique; loading marca aria-busy', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch aria-label="D" disabled onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    rerender(<Switch aria-label="D" loading onCheckedChange={onChange} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('foco de teclado visível e polegar sem transição sob reduced-motion', () => {
    const { container } = render(<Switch aria-label="F" />);
    expect(screen.getByRole('switch')).toHaveClass('focus-visible:focus-ring');
    const thumb = container.querySelector('span[aria-hidden="true"]');
    expect(thumb?.className).not.toMatch(/(^|\s)transition-/);
    expect(thumb?.className).toContain('motion-safe:transition-');
  });

  it('descrição fica associada via aria-describedby', () => {
    render(<Switch label="Modo" description="Liga o piloto automático" />);
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('Liga o piloto automático');
  });
});
