import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    /**
     * Hook de 30s, nao os 10s default (F60-S07).
     *
     * `beforeAll` de varios arquivos sobe o app inteiro e abre conexao com
     * Postgres, Redis e RabbitMQ. Medido isolado, so a fase de `collect` leva
     * ~19s nesta maquina; sob carga da suite completa o hook estoura os 10s e o
     * arquivo falha inteiro, com os testes marcados como skipped.
     *
     * Isso NAO e mascarar falha: o hook faz trabalho real e demorado, e 10s e um
     * numero que o Vitest escolheu sem saber disso. O sintoma
     * (`Hook timed out in 10000ms`) custou dois diagnosticos errados de
     * "regressao" antes de ser medido — ver tasks/COMMS.md.
     */
    hookTimeout: 30_000,
  },
});
