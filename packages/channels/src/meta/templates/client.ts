import { GRAPH_API_BASE } from '../../shared/graphClient';
import { MetaTemplateError } from './errors';
import type {
  CreateMetaTemplateArgs,
  ListMetaTemplatesArgs,
  MetaMessageTemplate,
  MetaTemplateCategory,
  MetaTemplateCreateInput,
  MetaTemplateStatus,
} from './types';
import { validateMetaTemplateCreateInput } from './validation';

export interface MetaTemplatesClientOptions {
  /** Override exclusivamente para testes; o default vem do GraphClient canonico. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxTemplates?: number;
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_TEMPLATES = 10_000;
const TEMPLATE_FIELDS = 'id,name,language,category,status,components,rejected_reason';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeStatus(raw: string | undefined): {
  status: MetaTemplateStatus;
  providerStatus?: string;
} {
  const value = raw?.toUpperCase();
  switch (value) {
    case 'APPROVED':
    case 'PENDING':
    case 'REJECTED':
    case 'PAUSED':
    case 'DISABLED':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return { status: value };
    default:
      return raw === undefined ? { status: 'UNKNOWN' } : { status: 'UNKNOWN', providerStatus: raw };
  }
}

function normalizeCategory(raw: string | undefined): {
  category: MetaTemplateCategory;
  providerCategory?: string;
} {
  const value = raw?.toUpperCase();
  switch (value) {
    case 'MARKETING':
    case 'UTILITY':
    case 'AUTHENTICATION':
      return { category: value };
    default:
      return raw === undefined
        ? { category: 'UNKNOWN' }
        : { category: 'UNKNOWN', providerCategory: raw };
  }
}

function normalizeTemplate(value: unknown): MetaMessageTemplate {
  if (!isRecord(value))
    throw new MetaTemplateError('invalid_response', { permanence: 'transient' });
  const externalId = asString(value['id']);
  const name = asString(value['name']);
  const language = asString(value['language']);
  if (externalId === undefined || name === undefined || language === undefined) {
    throw new MetaTemplateError('invalid_response', { permanence: 'transient' });
  }
  const status = normalizeStatus(asString(value['status']));
  const category = normalizeCategory(asString(value['category']));
  const components = Array.isArray(value['components']) ? value['components'] : [];
  const rejectionReason = asString(value['rejected_reason']) ?? asString(value['rejection_reason']);
  return {
    externalId,
    name,
    language,
    ...category,
    ...status,
    components,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
  };
}

function graphCode(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body['error'])) return undefined;
  const code = body['error']['code'];
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

function errorFromResponse(response: Response, body: unknown, now: number): MetaTemplateError {
  const code = graphCode(body);
  const common = { httpStatus: response.status, graphCode: code };
  if (response.status === 401)
    return new MetaTemplateError('authentication', { permanence: 'permanent', ...common });
  if (response.status === 403)
    return new MetaTemplateError('permission', { permanence: 'permanent', ...common });
  if (
    response.status === 429 ||
    code === 4 ||
    code === 17 ||
    code === 613 ||
    code === 80007 ||
    code === 130429
  ) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now);
    return new MetaTemplateError('rate_limit', {
      permanence: 'transient',
      ...common,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  if (response.status >= 500)
    return new MetaTemplateError('unavailable', { permanence: 'transient', ...common });
  // O Graph costuma devolver auth/permissao como HTTP 400; o codigo e mais preciso.
  if (code === 190)
    return new MetaTemplateError('authentication', { permanence: 'permanent', ...common });
  if (code === 10 || code === 200 || code === 299) {
    return new MetaTemplateError('permission', { permanence: 'permanent', ...common });
  }
  if (code === 1 || code === 2) {
    return new MetaTemplateError('unavailable', { permanence: 'transient', ...common });
  }
  return new MetaTemplateError('payload', { permanence: 'permanent', ...common });
}

function validPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export class MetaTemplatesClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly maxTemplates: number;
  private readonly now: () => number;

  constructor(options: MetaTemplatesClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? GRAPH_API_BASE).replace(/\/$/, '');
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = validPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.pageSize = validPositiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize');
    this.maxPages = validPositiveInteger(options.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
    this.maxTemplates = validPositiveInteger(
      options.maxTemplates ?? DEFAULT_MAX_TEMPLATES,
      'maxTemplates',
    );
    this.now = options.now ?? Date.now;
  }

  /** Percorre todos os cursores sem seguir a URL `next` retornada pelo provider. */
  async listAll(args: ListMetaTemplatesArgs): Promise<readonly MetaMessageTemplate[]> {
    this.validateCredentials(args);
    const templates: MetaMessageTemplate[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const query = new URLSearchParams({ fields: TEMPLATE_FIELDS, limit: String(this.pageSize) });
      if (cursor !== undefined) query.set('after', cursor);
      const body = await this.request(
        `/${encodeURIComponent(args.wabaId)}/message_templates?${query}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${args.accessToken}` },
        },
      );
      if (!isRecord(body) || !Array.isArray(body['data'])) {
        throw new MetaTemplateError('invalid_response', { permanence: 'transient' });
      }
      for (const item of body['data']) {
        templates.push(normalizeTemplate(item));
        if (templates.length > this.maxTemplates) {
          throw new MetaTemplateError('pagination', { permanence: 'transient' });
        }
      }

      const nextCursor = this.nextCursor(body);
      if (nextCursor === undefined) return templates;
      if (cursors.has(nextCursor)) {
        throw new MetaTemplateError('pagination', { permanence: 'transient' });
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new MetaTemplateError('pagination', { permanence: 'transient' });
  }

  async create(args: CreateMetaTemplateArgs): Promise<MetaMessageTemplate> {
    this.validateCredentials(args);
    validateMetaTemplateCreateInput(args.template);
    const payload = this.createPayload(args.template);
    const body = await this.request(`/${encodeURIComponent(args.wabaId)}/message_templates`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!isRecord(body) || asString(body['id']) === undefined) {
      throw new MetaTemplateError('invalid_response', { permanence: 'transient' });
    }
    return normalizeTemplate({
      id: body['id'],
      name: args.template.name,
      language: args.template.language,
      category: body['category'] ?? args.template.category,
      status: body['status'],
      components: args.template.components,
      rejected_reason: body['rejected_reason'],
    });
  }

  private createPayload(input: MetaTemplateCreateInput): Record<string, unknown> {
    return {
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
      ...(input.allowCategoryChange === undefined
        ? {}
        : { allow_category_change: input.allowCategoryChange }),
    };
  }

  private nextCursor(body: Record<string, unknown>): string | undefined {
    const paging = body['paging'];
    if (!isRecord(paging)) return undefined;
    const cursors = paging['cursors'];
    if (!isRecord(cursors)) return undefined;
    return asString(cursors['after']);
  }

  private validateCredentials(args: ListMetaTemplatesArgs): void {
    if (!/^[A-Za-z0-9_-]+$/.test(args.wabaId)) {
      throw new MetaTemplateError('payload', { permanence: 'permanent' });
    }
    if (args.accessToken.trim().length === 0) {
      throw new MetaTemplateError('authentication', { permanence: 'permanent' });
    }
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (controller.signal.aborted) {
          throw new MetaTemplateError('timeout', { permanence: 'transient' });
        }
        if (response.ok) {
          throw new MetaTemplateError('invalid_response', { permanence: 'transient' });
        }
      }
      if (!response.ok) throw errorFromResponse(response, body, this.now());
      return body;
    } catch (error: unknown) {
      if (error instanceof MetaTemplateError) throw error;
      if (controller.signal.aborted) {
        throw new MetaTemplateError('timeout', { permanence: 'transient' });
      }
      throw new MetaTemplateError('network', { permanence: 'transient' });
    } finally {
      clearTimeout(timer);
    }
  }
}
