import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    /**
     * Hook de 30s, nao os 10s default (F60-S07).
     *
     * Varios `beforeAll` deste pacote abrem conexao com Postgres, Redis e
     * RabbitMQ. Sob carga da suite completa o hook estoura os 10s e o arquivo
     * falha inteiro — sintoma `Hook timed out in 10000ms`, que custou dois
     * diagnosticos errados de "regressao" nesta fase antes de ser medido.
     * Ver tasks/COMMS.md.
     *
     * Nao e mascarar falha: o hook faz trabalho real e demorado.
     */
    hookTimeout: 30_000,
  },
});
