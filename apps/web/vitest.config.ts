import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve o alias `@/` (tsconfig `@/*` → `./*`) para o vitest, igual ao build/Next.
// Necessário para testar módulos que importam `@/shared/...` (ex.: F46-S01).
const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Testes unitarios do @hm/web (F41-S04). Foco atual: a logica pura do Portal do
 * Desenvolvedor (gerador de exemplo + mocks do Sandbox) e as provas estruturais
 * dos dois muros do console "Try it" (SUPPORT.md 6.3). Rodam em ambiente node
 * (sem DOM) — testes de hidratacao/UI ficam no Playwright (apps/web/e2e), que o
 * Next build nao compila em rota.
 */
export default defineConfig({
  resolve: {
    alias: { '@': rootDir },
  },
  test: {
    environment: 'node',
    include: [
      'features/**/*.test.ts',
      'features/**/*.test.tsx',
      'shared/**/*.test.ts',
      'shared/**/*.test.tsx',
    ],
    globals: true,
  },
});
