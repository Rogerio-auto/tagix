import { defineConfig } from 'vitest/config';

/**
 * Testes unitarios do @hm/web (F41-S04). Foco atual: a logica pura do Portal do
 * Desenvolvedor (gerador de exemplo + mocks do Sandbox) e as provas estruturais
 * dos dois muros do console "Try it" (SUPPORT.md 6.3). Rodam em ambiente node
 * (sem DOM) — testes de hidratacao/UI ficam no Playwright (apps/web/e2e), que o
 * Next build nao compila em rota.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['features/**/*.test.ts', 'features/**/*.test.tsx'],
    globals: true,
  },
});
