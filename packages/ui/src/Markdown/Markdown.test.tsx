import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './Markdown';
import { sanitizeUrl } from './sanitize';

/**
 * Contrato de SEGURANCA do render de Markdown (F38-S04/S05; alvo do audit S15).
 * O parser nunca emite HTML cru -> qualquer vetor de XSS no corpo vira texto.
 */

describe('Markdown — XSS estrutural', () => {
  it('nao executa <script>: vira texto literal, sem node <script> no DOM', () => {
    const { container } = render(<Markdown>{'Oi <script>alert(1)</script> fim'}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('nao injeta <iframe> nem <img onerror>', () => {
    const { container } = render(
      <Markdown>{'<iframe src=x></iframe> <img src=x onerror=alert(1)>'}</Markdown>,
    );
    expect(container.querySelector('iframe')).toBeNull();
    // a unica <img> possivel seria de markdown ![](url); HTML cru nunca cria uma.
    expect(container.querySelector('img')).toBeNull();
  });

  it('link javascript: e neutralizado para #', () => {
    const { container } = render(<Markdown>{'[clique](javascript:alert(1))'}</Markdown>);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('#');
  });

  it('link data: e neutralizado para #', () => {
    const { container } = render(
      <Markdown>{'[x](data:text/html,<script>alert(1)</script>)'}</Markdown>,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#');
  });

  it('link https valido sobrevive e ganha rel seguro + target', () => {
    const { container } = render(<Markdown>{'[doc](https://leadium.app/x)'}</Markdown>);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://leadium.app/x');
    expect(a?.getAttribute('rel')).toContain('noopener');
    expect(a?.getAttribute('rel')).toContain('noreferrer');
  });
});

describe('Markdown — render do subconjunto', () => {
  it('headings, listas, code e enfase', () => {
    const md = ['# Titulo', '', 'Texto **forte** e *enfase* e `cod`.', '', '- a', '- b'].join('\n');
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector('h1')?.textContent).toBe('Titulo');
    expect(container.querySelector('strong')?.textContent).toBe('forte');
    expect(container.querySelector('em')?.textContent).toBe('enfase');
    expect(container.querySelector('code')?.textContent).toBe('cod');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('code fence preserva conteudo sem interpretar', () => {
    const md = ['```', '<script>nope</script>', '```'].join('\n');
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector('pre code')?.textContent).toContain('<script>nope</script>');
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('sanitizeUrl — politica de esquema', () => {
  it('aceita http/https/mailto/tel e relativos', () => {
    expect(sanitizeUrl('https://x.com')).toBe('https://x.com');
    expect(sanitizeUrl('http://x.com')).toBe('http://x.com');
    expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(sanitizeUrl('/help/x')).toBe('/help/x');
    expect(sanitizeUrl('#sec')).toBe('#sec');
  });
  it('rejeita esquemas perigosos e protocol-relative', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('#');
    expect(sanitizeUrl(' vbscript:msgbox ')).toBe('#');
    expect(sanitizeUrl('data:text/html,x')).toBe('#');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('#');
    expect(sanitizeUrl('//evil.com')).toBe('#');
  });
});
