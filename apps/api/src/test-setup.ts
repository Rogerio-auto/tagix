import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Carrega o .env da raiz (DATABASE_URL, REDIS_URL) para os testes de integração.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });
