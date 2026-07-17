import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState — a11y e 3 partes (UX §2.11)', () => {
  it('anuncia via role=alert e mostra o quê / por quê / o que fazer', () => {
    render(
      <ErrorState
        title="Falha ao enviar"
        reason="A janela de 24h fechou"
        whatToDo="Use um template aprovado"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Falha ao enviar');
    expect(alert).toHaveTextContent('A janela de 24h fechou');
    expect(alert).toHaveTextContent('Use um template aprovado');
  });

  it('copia a referência técnica para a área de transferência', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ErrorState title="Erro" reference="hm_err_abc123" />);
    const btn = screen.getByRole('button', { name: /hm_err_abc123/i });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith('hm_err_abc123');
    await waitFor(() => expect(screen.getByText('Copiado')).toBeInTheDocument());
  });

  it('sem referência não renderiza o botão de cópia', () => {
    render(<ErrorState title="Erro" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
