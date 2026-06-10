import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createApp } from '../../app';
import { closeCache } from '../../cache';
import { closeHealth } from '../../health';

const app = createApp();

afterAll(async () => {
  await closeCache();
  await closeHealth();
  await closeDb();
});

describe('rotas de conversas', () => {
  it('GET /api/conversations sem sessão → 401', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('GET /api/conversations/:id/messages sem sessão → 401', async () => {
    const res = await request(app).get('/api/conversations/abc/messages');
    expect(res.status).toBe(401);
  });
});
