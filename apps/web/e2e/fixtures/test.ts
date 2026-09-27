/**
 * Base test estendida (F10-S03). Toda spec importa `test`/`expect` daqui — assim
 * os mocks de API ficam ligados ANTES de qualquer navegação, e o `mock` (estado
 * mutável do cenário) fica disponível para asserções de back-end simuladas.
 *
 * F70-S29: a fixture é `auto`. Antes ela só ligava quando o teste pedia `mock` nos
 * parâmetros — e a maioria dos testes só pedia `page`. Esses rodavam SEM mock: o
 * navegador batia no proxy do Next, o proxy na API real (ausente no CI) e o log
 * enchia de `Failed to proxy … ECONNREFUSED`. Mock opcional é mock esquecido.
 *
 * Os `page.route` que uma spec registra no corpo do teste têm prioridade sobre os
 * daqui (o Playwright consulta as rotas da mais nova para a mais antiga), então
 * sobrescrever um endpoint continua sendo só registrar a rota na spec.
 */

import { test as base, expect } from '@playwright/test';
import { installApiMocks, type MockState } from './api-mock';

interface Fixtures {
  /** Estado mutável dos mocks (mensagens, deals, canais) para asserções. */
  mock: MockState;
}

export const test = base.extend<Fixtures>({
  mock: [
    async ({ page }, use) => {
      const state = await installApiMocks(page);
      await use(state);
    },
    { auto: true },
  ],
});

export { expect };
