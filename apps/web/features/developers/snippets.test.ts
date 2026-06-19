import { describe, expect, it } from 'vitest';
import type { Endpoint, ResolvedSchema } from './openapi';
import {
  BASE,
  buildExample,
  buildSampleBody,
  buildSampleResponse,
  sampleForField,
} from './snippets';

/**
 * F41-S03 — gerador de exemplo + mock do Sandbox derivam do schema (S01), nunca
 * hardcoded. Cobre body required-only, nullable, enum, nested, array, params.
 */

const conversionResponse: ResolvedSchema = {
  name: 'ConversionCreatedResponse',
  root: {
    name: '',
    type: 'object',
    nullable: false,
    required: true,
    fields: [
      { name: 'status', type: 'string', nullable: false, required: true, enumValues: ['created', 'deduped'] },
      {
        name: 'conversion',
        type: 'object',
        nullable: true,
        required: true,
        fields: [
          { name: 'id', type: 'string', nullable: false, required: true, format: 'uuid' },
          { name: 'valueCents', type: 'integer', nullable: true, required: true },
        ],
      },
    ],
  },
};

const createConversionBody: ResolvedSchema = {
  name: 'CreateConversionRequest',
  root: {
    name: '',
    type: 'object',
    nullable: false,
    required: true,
    fields: [
      { name: 'conversionTypeKey', type: 'string', nullable: false, required: true, example: 'venda' },
      { name: 'contactId', type: 'string', nullable: false, required: true, format: 'uuid' },
      { name: 'note', type: 'string', nullable: false, required: false },
    ],
  },
};

const postEndpoint: Endpoint = {
  method: 'post',
  mutating: true,
  path: '/api/v1/conversions',
  summary: 'Registra uma conversao.',
  description: 'Requer o scope x.',
  scope: 'write:conversions',
  params: [],
  requestBody: createConversionBody,
  response: { status: '201', schema: conversionResponse },
};

const getEndpoint: Endpoint = {
  method: 'get',
  mutating: false,
  path: '/api/v1/contacts/{id}',
  summary: 'Detalhe de um contato.',
  description: 'Requer o scope x.',
  scope: 'read:contacts',
  params: [
    { name: 'id', location: 'path', type: 'string', required: true, format: 'uuid' },
  ],
  response: {
    status: '200',
    schema: {
      name: 'ContactGetResponse',
      root: {
        name: '',
        type: 'object',
        nullable: false,
        required: true,
        fields: [
          {
            name: 'contact',
            type: 'object',
            nullable: false,
            required: true,
            fields: [{ name: 'id', type: 'string', nullable: false, required: true, format: 'uuid' }],
          },
        ],
      },
    },
  },
};

describe('sampleForField', () => {
  it('prefere example, depois default, depois enum', () => {
    expect(sampleForField({ name: 'a', type: 'string', nullable: false, required: true, example: 'X' })).toBe('X');
    expect(sampleForField({ name: 'a', type: 'string', nullable: false, required: true, defaultValue: 'D' })).toBe('D');
    expect(
      sampleForField({ name: 'a', type: 'string', nullable: false, required: true, enumValues: ['e1', 'e2'] }),
    ).toBe('e1');
  });

  it('gera placeholder por format/type', () => {
    expect(sampleForField({ name: 'a', type: 'string', nullable: false, required: true, format: 'uuid' })).toMatch(
      /^[0-9a-f-]+$/,
    );
    expect(sampleForField({ name: 'a', type: 'integer', nullable: false, required: true })).toBe(0);
    expect(sampleForField({ name: 'a', type: 'boolean', nullable: false, required: true })).toBe(false);
  });
});

describe('buildSampleBody', () => {
  it('inclui obrigatorios e os com example/default; omite opcionais sem hint', () => {
    const body = buildSampleBody(createConversionBody);
    expect(body).toHaveProperty('conversionTypeKey', 'venda');
    expect(body).toHaveProperty('contactId');
    expect(body).not.toHaveProperty('note');
  });
});

describe('buildSampleResponse', () => {
  it('reflete o schema completo (mock do Sandbox), inclusive nested e enum', () => {
    const mock = buildSampleResponse(conversionResponse) as Record<string, unknown>;
    expect(mock['status']).toBe('created');
    expect(mock['conversion']).toMatchObject({ valueCents: 0 });
  });
});

describe('buildExample', () => {
  it('curl POST inclui metodo, url, auth header e body do schema', () => {
    const curl = buildExample(postEndpoint, 'curl');
    expect(curl).toContain('curl -X POST ' + BASE + '/api/v1/conversions');
    expect(curl).toContain('Authorization: Bearer');
    expect(curl).toContain('conversionTypeKey');
  });

  it('curl GET nao tem body nem Content-Type', () => {
    const curl = buildExample(getEndpoint, 'curl');
    expect(curl).toContain('curl ' + BASE + '/api/v1/contacts/');
    expect(curl).not.toContain('Content-Type');
    expect(curl).not.toContain('-d ');
  });

  it('JS usa fetch com method e Authorization', () => {
    const js = buildExample(postEndpoint, 'js');
    expect(js).toContain('fetch(');
    expect(js).toContain("method: 'POST'");
    expect(js).toContain('Authorization');
  });

  it('Python usa requests.<metodo> e converte JSON em dict', () => {
    const py = buildExample(postEndpoint, 'python');
    expect(py).toContain('requests.post(');
    expect(py).toContain("'conversionTypeKey'");
  });

  it('preenche path param no exemplo (sem deixar {id})', () => {
    const curl = buildExample(getEndpoint, 'curl');
    expect(curl).not.toContain('{id}');
  });
});
