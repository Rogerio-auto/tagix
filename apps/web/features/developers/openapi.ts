'use client';

/**
 * Carrega e modela o documento OpenAPI 3.1 da Leadium API (F38-S13 + F41-S01).
 * A spec e publica em /api/v1/openapi.json (nao exige API key). Modelamos o
 * subconjunto que o portal renderiza: metodo/path/scope + request body,
 * parametros (path/query) e response, com $ref resolvido para
 * components.schemas. Sem any: unknown + narrowing. O model alimenta a
 * referencia rica (S01) e o gerador buildExample (./snippets), reusado pelo
 * console "Try it" (S02).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const MUTATING_METHODS: ReadonlySet<HttpMethod> = new Set(['post', 'put', 'patch', 'delete']);

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiDoc {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'unknown';

export interface SchemaField {
  name: string;
  type: FieldType;
  nullable: boolean;
  required: boolean;
  format?: string;
  enumValues?: string[];
  description?: string;
  example?: unknown;
  defaultValue?: unknown;
  fields?: SchemaField[];
  items?: SchemaField;
}

export interface ResolvedSchema {
  name?: string;
  root: SchemaField;
}

export interface ParamField {
  name: string;
  location: 'path' | 'query';
  type: FieldType;
  required: boolean;
  format?: string;
  enumValues?: string[];
  description?: string;
  example?: unknown;
  defaultValue?: unknown;
}

export interface Endpoint {
  method: HttpMethod;
  mutating: boolean;
  path: string;
  summary: string;
  description: string;
  scope: string | null;
  params: ParamField[];
  requestBody?: ResolvedSchema;
  response?: { status: string; description?: string; schema?: ResolvedSchema };
}

export interface ResourceGroup {
  resource: string;
  endpoints: Endpoint[];
}

const REF_PREFIX = '#/components/schemas/';

function refName(node: Record<string, unknown>): string | undefined {
  const ref = asString(node['$ref']);
  if (ref && ref.startsWith(REF_PREFIX)) return ref.slice(REF_PREFIX.length);
  return undefined;
}

function readType(node: Record<string, unknown>): { type: FieldType; nullable: boolean } {
  const raw = node['type'];
  let nullable = false;
  let base: string | undefined;

  if (typeof raw === 'string') {
    base = raw;
  } else if (Array.isArray(raw)) {
    const strs = raw.filter((x): x is string => typeof x === 'string');
    nullable = strs.includes('null');
    base = strs.find((x) => x !== 'null');
  }

  if (!nullable) {
    for (const key of ['anyOf', 'oneOf'] as const) {
      const variants = node[key];
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (isRecord(v) && v['type'] === 'null') nullable = true;
        }
      }
    }
  }

  if (!base && isRecord(node['properties'])) base = 'object';
  if (!base && node['items'] !== undefined) base = 'array';

  const known: readonly string[] = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
  const type: FieldType = known.includes(base ?? '') ? (base as FieldType) : 'unknown';
  return { type, nullable };
}

function resolveField(
  name: string,
  node: unknown,
  required: boolean,
  schemas: Record<string, unknown>,
  seen: ReadonlySet<string>,
): SchemaField {
  if (!isRecord(node)) {
    return { name, type: 'unknown', nullable: false, required };
  }

  const rn = refName(node);
  if (rn) {
    if (seen.has(rn)) {
      return { name, type: 'object', nullable: false, required };
    }
    const target = schemas[rn];
    return resolveField(name, target, required, schemas, new Set([...seen, rn]));
  }

  const { type, nullable } = readType(node);
  const field: SchemaField = {
    name,
    type,
    nullable,
    required,
    format: asString(node['format']),
    enumValues: asStringArray(node['enum']),
    description: asString(node['description']),
    example: node['example'],
    defaultValue: node['default'],
  };

  if (type === 'object' && isRecord(node['properties'])) {
    const props = node['properties'];
    const req = new Set(asStringArray(node['required']) ?? []);
    field.fields = Object.entries(props).map(([k, v]) =>
      resolveField(k, v, req.has(k), schemas, seen),
    );
  }

  if (type === 'array' && node['items'] !== undefined) {
    field.items = resolveField('item', node['items'], false, schemas, seen);
  }

  return field;
}

function resolveSchema(
  node: unknown,
  schemas: Record<string, unknown>,
): ResolvedSchema | undefined {
  if (!isRecord(node)) return undefined;
  const name = refName(node);
  const root = resolveField('', node, true, schemas, new Set(name ? [name] : []));
  return name ? { name, root } : { root };
}

// backtick (96) construido dinamicamente para extrair o scope da descricao,
// no formato "Requer o scope <bt>read:contacts<bt>." do backend.
const BT = String.fromCharCode(96);
const WS = String.fromCharCode(92) + 's'; // \s p/ a RegExp sem escape no literal
const SCOPE_RE = new RegExp('scope' + WS + '+' + BT + '([^' + BT + ']+)' + BT);

function extractScope(description: string): string | null {
  const m = SCOPE_RE.exec(description);
  return m ? (m[1] ?? null) : null;
}

function resourceOf(path: string): string {
  const rest = path.replace(/^\/api\/v1\//, '');
  const seg = rest.split('/')[0] ?? 'geral';
  return seg.replace(/_/g, ' ');
}

function pathParams(path: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function readParam(node: Record<string, unknown>): ParamField | undefined {
  const name = asString(node['name']);
  const location = asString(node['in']);
  if (!name || (location !== 'path' && location !== 'query')) return undefined;
  const schema = isRecord(node['schema']) ? node['schema'] : {};
  const { type } = readType(schema);
  return {
    name,
    location,
    type,
    required: node['required'] === true,
    format: asString(schema['format']),
    enumValues: asStringArray(schema['enum']),
    description: asString(schema['description']) ?? asString(node['description']),
    example: schema['example'],
    defaultValue: schema['default'],
  };
}

function readRequestBody(
  op: Record<string, unknown>,
  schemas: Record<string, unknown>,
): ResolvedSchema | undefined {
  const rb = op['requestBody'];
  if (!isRecord(rb)) return undefined;
  const content = isRecord(rb['content']) ? rb['content'] : undefined;
  const json =
    content && isRecord(content['application/json']) ? content['application/json'] : undefined;
  return json ? resolveSchema(json['schema'], schemas) : undefined;
}

function readResponse(
  op: Record<string, unknown>,
  schemas: Record<string, unknown>,
): Endpoint['response'] {
  const responses = isRecord(op['responses']) ? op['responses'] : undefined;
  if (!responses) return undefined;
  const ok = Object.keys(responses)
    .filter((c) => /^2\d\d$/.test(c))
    .sort();
  const status = ok[0];
  if (!status) return undefined;
  const node = responses[status];
  if (!isRecord(node)) return { status };
  const content = isRecord(node['content']) ? node['content'] : undefined;
  const json =
    content && isRecord(content['application/json']) ? content['application/json'] : undefined;
  return {
    status,
    description: asString(node['description']),
    schema: json ? resolveSchema(json['schema'], schemas) : undefined,
  };
}

export function groupEndpoints(doc: OpenApiDoc): ResourceGroup[] {
  const schemas = doc.components?.schemas ?? {};
  const groups = new Map<string, Endpoint[]>();

  for (const [path, item] of Object.entries(doc.paths)) {
    if (!isRecord(item)) continue;
    for (const method of HTTP_METHODS) {
      const opRaw = item[method];
      if (!isRecord(opRaw)) continue;

      const description = asString(opRaw['description']) ?? '';

      const params: ParamField[] = pathParams(path).map((name) => ({
        name,
        location: 'path' as const,
        type: 'string' as FieldType,
        required: true,
        format: 'uuid',
        description: 'Identificador do recurso no workspace.',
      }));
      const rawParams = opRaw['parameters'];
      if (Array.isArray(rawParams)) {
        for (const p of rawParams) {
          if (isRecord(p)) {
            const parsed = readParam(p);
            if (parsed) params.push(parsed);
          }
        }
      }

      const endpoint: Endpoint = {
        method,
        mutating: MUTATING_METHODS.has(method),
        path,
        summary: asString(opRaw['summary']) ?? '',
        description,
        scope: extractScope(description),
        params,
        requestBody: readRequestBody(opRaw, schemas),
        response: readResponse(opRaw, schemas),
      };

      const key = resourceOf(path);
      const arr = groups.get(key) ?? [];
      arr.push(endpoint);
      groups.set(key, arr);
    }
  }

  return [...groups.entries()]
    .map(([resource, endpoints]) => ({ resource, endpoints }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

export function useOpenApi() {
  return useQuery({
    queryKey: ['developers', 'openapi'],
    queryFn: () => api.get<OpenApiDoc>('/api/v1/openapi.json'),
    staleTime: 5 * 60 * 1000,
  });
}
