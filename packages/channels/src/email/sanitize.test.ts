import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeEmailHtml } from './sanitize';

describe('o que precisa morrer, morre', () => {
  it('script sai com o conteúdo junto', () => {
    // Remover só a marcação deixaria `alert(1)` como texto visível.
    const r = sanitizeEmailHtml('<p>oi</p><script>alert(1)</script>');
    expect(r).not.toContain('script');
    expect(r).not.toContain('alert');
    expect(r).toContain('oi');
  });

  it('script aninhado que se reconstrói numa passada só', () => {
    // `<scr<script>ipt>` vira `<script>` se a remoção não for em laço.
    const r = sanitizeEmailHtml('<scr<script></script>ipt>alert(1)</scr<script></script>ipt>');
    expect(r.toLowerCase()).not.toContain('<script');
  });

  it('script aberto e nunca fechado leva o resto junto', () => {
    const r = sanitizeEmailHtml('<p>antes</p><script>alert(1)');
    expect(r).not.toContain('alert');
    expect(r).toContain('antes');
  });

  it('style sai com o conteúdo (expression e url javascript)', () => {
    const r = sanitizeEmailHtml('<style>a{background:url(javascript:alert(1))}</style><p>x</p>');
    expect(r).not.toContain('javascript');
    expect(r).toContain('x');
  });

  it.each(['iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'])(
    'tag %s não está na lista de permissão e é removida',
    (tag) => {
      const r = sanitizeEmailHtml(`<${tag}>conteudo</${tag}>`);
      expect(r).not.toContain(`<${tag}`);
    },
  );

  it('svg com onload não sobrevive', () => {
    const r = sanitizeEmailHtml('<svg onload="alert(1)"><circle /></svg>');
    expect(r).not.toContain('svg');
    expect(r).not.toContain('onload');
  });

  it('comentário HTML sai — pode esconder marcação condicional', () => {
    const r = sanitizeEmailHtml('<p>a</p><!--[if IE]><script>x</script><![endif]--><p>b</p>');
    expect(r).not.toContain('script');
    expect(r).toContain('a');
    expect(r).toContain('b');
  });
});

describe('atributos: lista de permissão por tag', () => {
  it('handler de evento nunca sobrevive', () => {
    for (const attr of ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus']) {
      const r = sanitizeEmailHtml(`<p ${attr}="alert(1)">x</p>`);
      expect(r).not.toContain(attr);
      expect(r).not.toContain('alert');
    }
  });

  it('a href http/https/mailto passa', () => {
    for (const url of ['https://x.com', 'http://x.com', 'mailto:a@b.com', '/relativo']) {
      expect(sanitizeEmailHtml(`<a href="${url}">l</a>`)).toContain(url);
    }
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java&#115;cript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('href perigoso é removido: %s', (url) => {
    const r = sanitizeEmailHtml(`<a href="${url}">l</a>`);
    expect(r).not.toMatch(/javascript|vbscript|data:text/i);
    // A tag fica, sem o href — o texto do link continua legível.
    expect(r).toContain('<a>');
  });

  it('img src perigoso é removido mas a tag sobrevive', () => {
    const r = sanitizeEmailHtml('<img src="javascript:alert(1)" alt="foto">');
    expect(r).not.toContain('javascript');
    expect(r).toContain('alt="foto"');
  });

  it('atributo fora da lista da tag some (style, class, id)', () => {
    const r = sanitizeEmailHtml('<p style="x" class="y" id="z">t</p>');
    expect(r).toBe('<p>t</p>');
  });

  it('cid: é aceito — anexo embutido, resolvido depois', () => {
    expect(sanitizeEmailHtml('<img src="cid:abc123">')).toContain('cid:abc123');
  });
});

describe('o que deve sobreviver, sobrevive', () => {
  it('formatação comum de e-mail passa intacta', () => {
    const html =
      '<div><p><strong>Orçamento</strong> da <em>cozinha</em></p>' +
      '<ul><li>Piso</li><li>Bancada</li></ul>' +
      '<table><tr><td colspan="2">Total</td></tr></table></div>';
    const r = sanitizeEmailHtml(html);
    expect(r).toContain('<strong>');
    expect(r).toContain('<li>');
    expect(r).toContain('colspan="2"');
  });

  it('entrada vazia devolve vazio', () => {
    expect(sanitizeEmailHtml('')).toBe('');
    expect(sanitizeEmailHtml(null)).toBe('');
    expect(sanitizeEmailHtml(undefined)).toBe('');
  });

  it('menor-que solto vira entidade em vez de abrir tag', () => {
    const r = sanitizeEmailHtml('<p>se a < b entao</p>');
    expect(r).toContain('&lt;');
  });

  it('é idempotente — sanitizar duas vezes não muda nada', () => {
    const html = '<p>a<a href="https://x.com">l</a><script>x</script></p>';
    const uma = sanitizeEmailHtml(html);
    expect(sanitizeEmailHtml(uma)).toBe(uma);
  });
});

describe('htmlToText', () => {
  it('extrai texto legível para prévia e busca', () => {
    const t = htmlToText('<p>Olá,</p><p>segue o <strong>orçamento</strong>.</p>');
    expect(t).toContain('Olá,');
    expect(t).toContain('orçamento');
    expect(t).not.toContain('<');
  });

  it('quebra de linha vira quebra de verdade', () => {
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });

  it('não vaza script pelo caminho do texto', () => {
    expect(htmlToText('<script>alert(1)</script><p>ok</p>')).toBe('ok');
  });

  it('entidades comuns viram os caracteres', () => {
    expect(htmlToText('<p>a &amp; b &quot;c&quot;</p>')).toBe('a & b "c"');
  });
});
