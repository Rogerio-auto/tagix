/**
 * F71-S10 — roda o tick REAL de fim de trial do worker de cobrança (`expireTrials`, F71-S06)
 * contra o banco de dev, para o teste de jornada da API.
 *
 * Existe porque o código vive em `apps/workers` e o vite-node do vitest da API não carrega
 * fontes fora do root (e o `rootDir` do tsc da API proíbe o import estático). Rodado em um
 * processo próprio via tsx: `tsx --env-file=.env apps/api/test/run-expire-trials.ts <workspaceId>`.
 * Imprime uma linha JSON `{"expired": <n>}`.
 */
import { closeDb } from '@hm/db';
import { createLogger } from '@hm/logger';
import { createBillingDbPort, expireTrials } from '../../workers/src/billing/recurrence';

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error('uso: run-expire-trials.ts <workspaceId>');
  process.exit(2);
}

try {
  const expired = await expireTrials(
    { db: createBillingDbPort(), logger: createLogger('error') },
    { now: new Date(), workspaceId },
  );
  console.log(JSON.stringify({ expired }));
} finally {
  await closeDb();
}
