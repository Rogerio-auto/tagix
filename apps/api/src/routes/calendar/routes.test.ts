import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { can } from '@hm/shared';
import { createCalendarRouter } from './index';
import { canAccessCalendar } from '../../middlewares/calendar-access';

const app = express();
app.use(express.json());
app.use(createCalendarRouter());

afterAll(async () => {
  await closeDb();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('rotas de calendar (autorizacao)', () => {
  it('GET /api/calendars sem sessao -> 401', async () => {
    expect((await request(app).get('/api/calendars')).status).toBe(401);
  });
  it('POST /api/calendars sem sessao -> 401', async () => {
    expect((await request(app).post('/api/calendars').send({})).status).toBe(401);
  });
  it('GET /api/calendars/:id sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/calendars/${ID}`)).status).toBe(401);
  });
  it('GET /api/calendars/:id/events sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/calendars/${ID}/events`)).status).toBe(401);
  });
  it('GET /api/availability/rules sem sessao -> 401', async () => {
    expect((await request(app).get('/api/availability/rules')).status).toBe(401);
  });
  it('PUT /api/availability/rules sem sessao -> 401', async () => {
    expect((await request(app).put('/api/availability/rules').send({ rules: [] })).status).toBe(401);
  });
  it('GET /api/availability/slots sem sessao -> 401', async () => {
    expect((await request(app).get('/api/availability/slots?date=2099-01-05')).status).toBe(401);
  });
  it('GET /api/events sem sessao -> 401', async () => {
    expect((await request(app).get('/api/events')).status).toBe(401);
  });
  it('POST /api/events sem sessao -> 401', async () => {
    expect((await request(app).post('/api/events').send({})).status).toBe(401);
  });
  it('POST /api/events/:id/cancel sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/events/${ID}/cancel`)).status).toBe(401);
  });
  it('POST /api/events/:id/rsvp sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/events/${ID}/rsvp`).send({ rsvp: 'accepted' })).status).toBe(401);
  });
});

describe('matriz de permissoes calendar.*', () => {
  it('calendar.view e ALL; calendar.manage e MANAGERS; availability/event.edit e STAFF', () => {
    expect(can('READONLY', 'calendar.view')).toBe(true);
    expect(can('SUPERVISOR', 'calendar.manage')).toBe(true);
    expect(can('AGENT', 'calendar.manage')).toBe(false);
    expect(can('AGENT', 'availability.edit')).toBe(true);
    expect(can('READONLY', 'availability.edit')).toBe(false);
    expect(can('AGENT', 'event.edit')).toBe(true);
    expect(can('READONLY', 'event.edit')).toBe(false);
  });
});

describe('canAccessCalendar (ownership fino §8)', () => {
  const base = {
    id: ID,
    workspaceId: ID,
    name: 'X',
    teamId: null,
    color: '#1FFF13',
    description: null,
    timezone: 'America/Sao_Paulo',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: null,
  };

  it('workspace calendar -> qualquer member', () => {
    const cal = { ...base, type: 'workspace' as const, ownerId: null };
    expect(canAccessCalendar(cal, { id: 'm1', role: 'AGENT' })).toBe(true);
    expect(canAccessCalendar(cal, { id: 'm1', role: 'READONLY' })).toBe(true);
  });

  it('personal calendar -> dono ou admin; nao outros', () => {
    const cal = { ...base, type: 'personal' as const, ownerId: 'owner1' };
    expect(canAccessCalendar(cal, { id: 'owner1', role: 'AGENT' })).toBe(true);
    expect(canAccessCalendar(cal, { id: 'm2', role: 'ADMIN' })).toBe(true);
    expect(canAccessCalendar(cal, { id: 'm2', role: 'AGENT' })).toBe(false);
  });

  it('team calendar -> managers; nao agent', () => {
    const cal = { ...base, type: 'team' as const, ownerId: null };
    expect(canAccessCalendar(cal, { id: 'm1', role: 'SUPERVISOR' })).toBe(true);
    expect(canAccessCalendar(cal, { id: 'm1', role: 'AGENT' })).toBe(false);
  });
});
