/**
 * Base test estendida (F10-S03). Toda spec importa `test`/`expect` daqui — assim
 * os mocks de API ficam ligados ANTES de qualquer navegação, e o `mock` (estado
 * mutável do cenário) fica disponível para asserções de back-end simuladas.
 */

import { test as base, expect } from '@playwright/test';
import { installApiMocks, type MockState } from './api-mock';

interface Fixtures {
  /** Estado mutável dos mocks (mensagens, deals, canais) para asserções. */
  mock: MockState;
}

export const test = base.extend<Fixtures>({
  mock: async ({ page }, use) => {
    const state = await installApiMocks(page);
    await use(state);
  },
});

export { expect };
