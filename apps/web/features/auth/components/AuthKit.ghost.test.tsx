// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scrubGhostFields } from './AuthKit';

/**
 * Privacidade (ADR-006 §9): o fantasma da troca de etapa é um clone do DOM. `cloneNode` copia o
 * valor ATUAL dos campos; ele não pode carregar e-mail nem senha, nem por 160 ms.
 */
describe('scrubGhostFields', () => {
  it('esvazia valor digitado, atributo value e name de input e textarea do clone', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="email" type="email" value="padrao@exemplo.com" />
      <input name="password" type="password" />
      <textarea name="nota"></textarea>`;
    const [email, password] = Array.from(form.querySelectorAll('input'));
    const note = form.querySelector('textarea');
    if (!email || !password || !note) throw new Error('fixture inválida');
    email.value = 'pessoa@empresa.com';
    password.value = 'segredo-super-digitado';
    note.value = 'texto livre';

    const ghost = form.cloneNode(true) as HTMLFormElement;
    // O clone realmente herda o que foi digitado (é o problema que a função resolve).
    expect(ghost.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe(
      'segredo-super-digitado',
    );

    scrubGhostFields(ghost);

    for (const field of Array.from(ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))) {
      expect(field.value).toBe('');
      expect(field.hasAttribute('value')).toBe(false);
      expect(field.hasAttribute('name')).toBe(false);
    }
    expect(ghost.outerHTML).not.toContain('segredo-super-digitado');
    expect(ghost.outerHTML).not.toContain('pessoa@empresa.com');
    // O original não é afetado.
    expect(password.value).toBe('segredo-super-digitado');
  });
});
