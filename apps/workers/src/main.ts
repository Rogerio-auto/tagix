/**
 * Entrypoint do processo de workers (`@hm/workers`).
 *
 * Dá boot em todos os consumers (inbound, outbound, media) via `startWorkers`
 * e instala shutdown gracioso (SIGINT/SIGTERM). `src/index.ts` permanece o
 * barrel de biblioteca; este é o entry de PROCESSO (scripts `dev`/`start`).
 */
import { main } from './bootstrap';

void main();
