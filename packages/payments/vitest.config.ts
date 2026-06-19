import { defineConfig } from 'vitest/config';

// Testes unit do pacote @hm/payments (mock provider + verifyWebhookSignature). Sem rede.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    environment: 'node',
  },
});
