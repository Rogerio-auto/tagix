import { defineConfig } from 'vitest/config';

// Testes unit do cliente agent-runtime (contrato Zod + SSE + erros). Sem rede.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
