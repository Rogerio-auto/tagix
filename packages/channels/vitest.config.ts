import { defineConfig } from 'vitest/config';

// Testes unit do pacote channels (parser/serializer WA). Sem rede.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    environment: 'node',
  },
});
