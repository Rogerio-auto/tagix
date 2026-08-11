import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaTemplatesClient } from './client';
import { MetaTemplateError } from './errors';
import type { MetaTemplateCreateInput } from './types';

const TOKEN = 'super-secret-access-token';

function response(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fetchMock(
  implementation: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

function approved(id: string): Record<string, unknown> {
  return {
    id,
    name: `modelo_${id}`,
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'APPROVED',
    components: [{ type: 'BODY', text: 'Conteudo externo' }],
  };
}

const VALID_TEMPLATE: MetaTemplateCreateInput = {
  name: 'confirmacao_pedido',
  language: 'pt_BR',
  category: 'UTILITY',
  components: [
    {
      type: 'HEADER',
      format: 'TEXT',
      text: 'Pedido {{1}}',
      example: { header_text: ['123'] },
    },
    {
      type: 'BODY',
      text: 'Ola {{1}}, seu pedido {{2}} foi confirmado.',
      example: { body_text: [['Ana', '123']] },
    },
    { type: 'FOOTER', text: 'Obrigado' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Acompanhar', url: 'https://example.test/{{1}}', example: ['123'] },
      ],
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('MetaTemplatesClient.listAll', () => {
  it('percorre todos os cursores e nunca reutiliza a URL next do provider', async () => {
    const calledUrls: string[] = [];
    const mock = fetchMock(async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('after=cursor-1')) return response({ data: [approved('2')] });
      return response({
        data: [approved('1')],
        paging: {
          cursors: { after: 'cursor-1' },
          next: `https://evil.invalid/next?access_token=${TOKEN}`,
        },
      });
    });
    const client = new MetaTemplatesClient({ fetch: mock, baseUrl: 'https://graph.test/v23.0' });

    const templates = await client.listAll({ wabaId: 'waba-1', accessToken: TOKEN });

    expect(templates.map((template) => template.externalId)).toEqual(['1', '2']);
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[1]).toContain('after=cursor-1');
    expect(calledUrls.join(' ')).not.toContain(TOKEN);
  });

  it('interrompe cursor repetido com erro transitorio tipado', async () => {
    const mock = fetchMock(async () =>
      response({ data: [], paging: { cursors: { after: 'same' } } }),
    );
    const client = new MetaTemplatesClient({
      fetch: mock,
      baseUrl: 'https://graph.test',
      maxPages: 10,
    });

    await expect(client.listAll({ wabaId: 'waba', accessToken: TOKEN })).rejects.toMatchObject({
      kind: 'pagination',
      permanence: 'transient',
      retryable: true,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('aplica limite defensivo de paginas', async () => {
    let cursor = 0;
    const mock = fetchMock(async () => {
      cursor += 1;
      return response({ data: [], paging: { cursors: { after: `cursor-${cursor}` } } });
    });
    const client = new MetaTemplatesClient({
      fetch: mock,
      baseUrl: 'https://graph.test',
      maxPages: 2,
    });

    await expect(client.listAll({ wabaId: 'waba', accessToken: TOKEN })).rejects.toMatchObject({
      kind: 'pagination',
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('preserva status/categoria desconhecidos, componentes opacos e motivo de rejeicao', async () => {
    const components: unknown[] = [{ type: 'FUTURE_COMPONENT', secret_shape: { enabled: true } }];
    const mock = fetchMock(async () =>
      response({
        data: [
          {
            id: 'remote-1',
            name: 'modelo_futuro',
            language: 'pt_BR',
            status: 'SOMETHING_NEW',
            category: 'FUTURE_CATEGORY',
            components,
            rejected_reason: 'POLICY_REASON',
          },
        ],
      }),
    );
    const client = new MetaTemplatesClient({ fetch: mock, baseUrl: 'https://graph.test' });

    const [template] = await client.listAll({ wabaId: 'waba', accessToken: TOKEN });

    expect(template).toEqual({
      externalId: 'remote-1',
      name: 'modelo_futuro',
      language: 'pt_BR',
      status: 'UNKNOWN',
      providerStatus: 'SOMETHING_NEW',
      category: 'UNKNOWN',
      providerCategory: 'FUTURE_CATEGORY',
      components,
      rejectionReason: 'POLICY_REASON',
    });
  });
});

describe('MetaTemplatesClient errors', () => {
  it('tipa 429 como transitorio e respeita Retry-After sem expor resposta/token', async () => {
    const providerContent = 'provider-secret-template-content';
    const mock = fetchMock(async () =>
      response({ error: { code: 4, message: providerContent } }, 429, { 'retry-after': '7' }),
    );
    const client = new MetaTemplatesClient({ fetch: mock, baseUrl: 'https://graph.test' });

    let caught: unknown;
    try {
      await client.listAll({ wabaId: 'waba', accessToken: TOKEN });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MetaTemplateError);
    expect(caught).toMatchObject({
      kind: 'rate_limit',
      permanence: 'transient',
      retryAfterMs: 7000,
      httpStatus: 429,
      graphCode: 4,
    });
    expect(String(caught)).not.toContain(providerContent);
    expect(String(caught)).not.toContain(TOKEN);
  });

  it('tipa 5xx como indisponibilidade transitoria', async () => {
    const client = new MetaTemplatesClient({
      fetch: fetchMock(async () => response({ error: { message: 'private' } }, 503)),
      baseUrl: 'https://graph.test',
    });
    await expect(client.listAll({ wabaId: 'waba', accessToken: TOKEN })).rejects.toMatchObject({
      kind: 'unavailable',
      permanence: 'transient',
      httpStatus: 503,
    });
  });

  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [400, 'payload'],
  ] as const)('tipa HTTP %i como erro permanente %s', async (status, kind) => {
    const client = new MetaTemplatesClient({
      fetch: fetchMock(async () => response({ error: { code: 100, message: 'private' } }, status)),
      baseUrl: 'https://graph.test',
    });
    await expect(client.listAll({ wabaId: 'waba', accessToken: TOKEN })).rejects.toMatchObject({
      kind,
      permanence: 'permanent',
      retryable: false,
      httpStatus: status,
    });
  });

  it.each([
    [190, 'authentication', 'permanent'],
    [10, 'permission', 'permanent'],
    [4, 'rate_limit', 'transient'],
    [2, 'unavailable', 'transient'],
  ] as const)(
    'usa o codigo Graph %i quando o HTTP 400 e generico',
    async (code, kind, permanence) => {
      const client = new MetaTemplatesClient({
        fetch: fetchMock(async () => response({ error: { code, message: 'private' } }, 400)),
        baseUrl: 'https://graph.test',
      });
      await expect(client.listAll({ wabaId: 'waba', accessToken: TOKEN })).rejects.toMatchObject({
        kind,
        permanence,
        graphCode: code,
      });
    },
  );

  it('aborta no timeout e devolve erro transitorio deterministico', async () => {
    vi.useFakeTimers();
    const mock = fetchMock(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('request carried sensitive content')),
          );
        }),
    );
    const client = new MetaTemplatesClient({
      fetch: mock,
      baseUrl: 'https://graph.test',
      timeoutMs: 50,
    });

    const pending = client.listAll({ wabaId: 'waba', accessToken: TOKEN });
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'timeout',
      permanence: 'transient',
    });
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });
});

describe('MetaTemplatesClient.create', () => {
  it('valida payload completo antes da rede e nao inclui valores nos issues', async () => {
    const mock = fetchMock(async () => response({ id: 'should-not-happen' }));
    const invalid = {
      ...VALID_TEMPLATE,
      components: [
        { type: 'BODY', text: 'Ola {{2}} e {{nome}}' },
        { type: 'FOOTER', text: 'Nao usar {{1}}' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: '', url: 'https://example.test/{{1}}' }],
        },
      ],
    } as unknown as MetaTemplateCreateInput;
    const client = new MetaTemplatesClient({ fetch: mock, baseUrl: 'https://graph.test' });

    let caught: unknown;
    try {
      await client.create({ wabaId: 'waba', accessToken: TOKEN, template: invalid });
    } catch (error: unknown) {
      caught = error;
    }

    expect(mock).not.toHaveBeenCalled();
    expect(caught).toMatchObject({ kind: 'validation', permanence: 'permanent' });
    expect(caught).toBeInstanceOf(MetaTemplateError);
    const validation = caught as MetaTemplateError;
    expect(validation.issues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'variables_not_sequential',
        'invalid_variable_syntax',
        'example_required',
        'footer_variables_not_allowed',
        'required_string',
        'invalid_example',
      ]),
    );
    expect(JSON.stringify(validation.issues)).not.toContain('Nao usar');
  });

  it('envia payload validado e normaliza a resposta de criacao', async () => {
    let sentBody: unknown;
    const mock = fetchMock(async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return response({ id: 'remote-created', status: 'PENDING', category: 'UTILITY' });
    });
    const client = new MetaTemplatesClient({ fetch: mock, baseUrl: 'https://graph.test' });

    const created = await client.create({
      wabaId: 'waba',
      accessToken: TOKEN,
      template: VALID_TEMPLATE,
    });

    expect(sentBody).toMatchObject({
      name: VALID_TEMPLATE.name,
      language: VALID_TEMPLATE.language,
      category: VALID_TEMPLATE.category,
      components: VALID_TEMPLATE.components,
    });
    expect(created).toMatchObject({
      externalId: 'remote-created',
      name: VALID_TEMPLATE.name,
      language: VALID_TEMPLATE.language,
      category: 'UTILITY',
      status: 'PENDING',
      components: VALID_TEMPLATE.components,
    });
  });
});
