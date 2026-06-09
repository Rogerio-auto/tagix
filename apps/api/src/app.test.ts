import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createApp } from './app';
import { closeHealth } from './health';

const app = createApp();

afterAll(async () => {
  await closeHealth();
  await closeDb();
});

describe('API server', () => {
  it('GET /health → 200 com db e redis conectados', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('connected');
    expect(res.body.redis).toBe('connected');
  });

  it('GET /api/me sem sessão → 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });
});
