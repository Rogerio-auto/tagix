import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    // Testes de integração tocam o Postgres dev — execução serial evita corrida.
    fileParallelism: false,
  },
});
