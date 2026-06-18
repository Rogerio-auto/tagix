import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnchoredHelpHint } from './AnchoredHelpHint';
import type { AnchoredHelpArticle } from './types';

const article: AnchoredHelpArticle = {
  slug: 'como-criar-um-agente',
  title: 'Como criar um agente',
  excerpt: 'Resumo do artigo.',
  bodyMd: '## Titulo\n\nCorpo com **negrito**.',
};

describe('AnchoredHelpHint (F38-S06)', () => {
  it('so busca ao abrir (lazy) e mostra o artigo + link para o slug', async () => {
    const fetcher = vi.fn().mockResolvedValue(article);
    render(<AnchoredHelpHint anchorKey="agents.list" fetcher={fetcher} />);
    // Nao buscou ainda.
    expect(fetcher).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /ajuda sobre/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('agents.list'));

    expect(await screen.findByText('Resumo do artigo.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /ver artigo completo/i });
    expect(link).toHaveAttribute('href', '/help/como-criar-um-agente');
  });

  it('fallback silencioso quando nao ha artigo: aviso + link para /help', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    render(<AnchoredHelpHint anchorKey="nope" fetcher={fetcher} />);
    fireEvent.click(screen.getByRole('button', { name: /ajuda sobre/i }));
    expect(await screen.findByText(/nao ha um artigo de ajuda/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /central de ajuda/i });
    expect(link).toHaveAttribute('href', '/help');
  });

  it('respeita helpBasePath custom', async () => {
    const fetcher = vi.fn().mockResolvedValue(article);
    render(<AnchoredHelpHint anchorKey="x" fetcher={fetcher} helpBasePath="/ajuda" />);
    fireEvent.click(screen.getByRole('button', { name: /ajuda sobre/i }));
    const link = await screen.findByRole('link', { name: /ver artigo completo/i });
    expect(link).toHaveAttribute('href', '/ajuda/como-criar-um-agente');
  });
});
