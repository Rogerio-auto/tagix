import { defineConfig } from 'vitest/config';

/**
 * Testes de componente do @hm/ui rodam em DOM emulado (happy-dom) com
 * @testing-library/react. Foco: contratos de acessibilidade (roles, labels,
 * aria-live, foco) — não snapshot visual (isso é Ladle/Chromatic, §12).
 *
 * NOTA F10-S05: requer devDeps `vitest`, `happy-dom`, `@testing-library/react`,
 * `@testing-library/dom` + script `"test": "vitest run"` no package.json.
 * O slot não pôde adicioná-los (package.json fora da fronteira); ver relatório.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
