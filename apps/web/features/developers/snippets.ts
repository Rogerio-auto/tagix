/**
 * Gerador de exemplos de requisicao da Leadium API (F38-S13 + F41-S01).
 *
 * buildExample(endpoint, lang) monta curl/JS/Python a partir do model do
 * OpenAPI (./openapi): metodo, path, params (path/query) e body-schema. Os
 * valores vem do schema (example/default/format) ou de placeholders tipados,
 * nada hardcoded por endpoint. O mesmo buildSampleBody/buildSampleResponse
 * alimenta o Sandbox do console (S02): mock 100% client-side.
 */
import type { Endpoint, FieldType, ParamField, ResolvedSchema, SchemaField } from './openapi';

export const BASE = 'https://api.leadium.app';

export type SnippetLang = 'curl' | 'js' | 'python';

function placeholderForFormat(format: string | undefined, type: FieldType): unknown {
  if (format === 'uuid') return '00000000-0000-0000-0000-000000000000';
  if (format === 'email') return 'contato@exemplo.com';
  if (format === 'uri' || format === 'url') return 'https://exemplo.com/arquivo.png';
  if (format === 'date-time') return '2025-01-01T12:00:00.000Z';
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  return 'texto';
}

export function sampleForField(field: SchemaField): unknown {
  if (field.example !== undefined) return field.example;
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.enumValues && field.enumValues.length > 0) return field.enumValues[0];

  switch (field.type) {
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const child of field.fields ?? []) {
        obj[child.name] = sampleForField(child);
      }
      return obj;
    }
    case 'array': {
      return field.items ? [sampleForField(field.items)] : [];
    }
    case 'string':
      return placeholderForFormat(field.format, 'string');
    case 'integer':
    case 'number':
      return placeholderForFormat(field.format, field.type);
    case 'boolean':
      return false;
    default:
      return null;
  }
}

export function buildSampleBody(schema: ResolvedSchema | undefined): Record<string, unknown> {
  if (!schema || schema.root.type !== 'object') return {};
  const obj: Record<string, unknown> = {};
  for (const field of schema.root.fields ?? []) {
    const interesting =
      field.required || field.example !== undefined || field.defaultValue !== undefined;
    if (interesting) obj[field.name] = sampleForField(field);
  }
  return obj;
}

export function buildSampleResponse(schema: ResolvedSchema | undefined): unknown {
  if (!schema) return {};
  return sampleForField(schema.root);
}

function sampleForParam(p: ParamField): string {
  if (p.example !== undefined) return String(p.example);
  if (p.defaultValue !== undefined) return String(p.defaultValue);
  if (p.enumValues && p.enumValues.length > 0) return String(p.enumValues[0]);
  return String(placeholderForFormat(p.format, p.type));
}

function fillPath(endpoint: Endpoint): string {
  let path = endpoint.path;
  for (const p of endpoint.params) {
    if (p.location === 'path') {
      path = path.replace('{' + p.name + '}', encodeURIComponent(sampleForParam(p)));
    }
  }
  return path;
}

function buildQuery(endpoint: Endpoint): string {
  const pairs: string[] = [];
  for (const p of endpoint.params) {
    if (p.location === 'query' && p.required) {
      pairs.push(encodeURIComponent(p.name) + '=' + encodeURIComponent(sampleForParam(p)));
    }
  }
  return pairs.length > 0 ? '?' + pairs.join('&') : '';
}

const KEY_PLACEHOLDER = 'SUA_API_KEY';
const BS = String.fromCharCode(92); // backslash p/ continuacao de linha no curl
const TICK = String.fromCharCode(96); // backtick p/ template literal no snippet JS
const DOLLAR = String.fromCharCode(36); // cifrao p/ interpolacao no snippet JS

function buildCurl(endpoint: Endpoint, url: string, hasBody: boolean, body: string): string {
  const lines: string[] = [];
  const auth = '-H "Authorization: Bearer ' + KEY_PLACEHOLDER + '"';
  if (endpoint.method === 'get') {
    return ['curl ' + url + ' ' + BS, '  ' + auth].join('\n');
  }
  lines.push('curl -X ' + endpoint.method.toUpperCase() + ' ' + url + ' ' + BS);
  if (hasBody) {
    lines.push('  ' + auth + ' ' + BS);
    lines.push('  -H "Content-Type: application/json" ' + BS);
    lines.push('  -d ' + String.fromCharCode(39) + body + String.fromCharCode(39));
  } else {
    lines.push('  ' + auth);
  }
  return lines.join('\n');
}

function buildJs(endpoint: Endpoint, url: string, hasBody: boolean, bodyPretty: string): string {
  const lines: string[] = [];
  const interp = TICK + 'Bearer ' + DOLLAR + '{process.env.LEADIUM_API_KEY}' + TICK;
  lines.push('const res = await fetch(' + String.fromCharCode(39) + url + String.fromCharCode(39) + ', {');
  lines.push('  method: ' + String.fromCharCode(39) + endpoint.method.toUpperCase() + String.fromCharCode(39) + ',');
  lines.push('  headers: {');
  lines.push('    Authorization: ' + interp + ',');
  if (hasBody) lines.push('    "Content-Type": "application/json",');
  lines.push('  },');
  if (hasBody) lines.push('  body: JSON.stringify(' + bodyPretty + '),');
  lines.push('});');
  lines.push('const data = await res.json();');
  return lines.join('\n');
}

function pyDict(body: string): string {
  return body
    .replace(/"([^"]+)":/g, "'$1':")
    .replace(/:\s*"([^"]*)"/g, ": '$1'")
    .replace(/:\s*true/g, ': True')
    .replace(/:\s*false/g, ': False')
    .replace(/:\s*null/g, ': None');
}

function buildPython(endpoint: Endpoint, url: string, hasBody: boolean, body: string): string {
  const q = String.fromCharCode(39);
  const lines: string[] = [];
  lines.push('import os, requests');
  lines.push('');
  lines.push('res = requests.' + endpoint.method + '(');
  lines.push('    ' + q + url + q + ',');
  lines.push('    headers={' + q + 'Authorization' + q + ': f"Bearer {os.environ[' + q + 'LEADIUM_API_KEY' + q + ']}"},');
  if (hasBody) lines.push('    json=' + pyDict(body) + ',');
  lines.push(')');
  lines.push('data = res.json()');
  return lines.join('\n');
}

export function buildExample(endpoint: Endpoint, lang: SnippetLang): string {
  const url = BASE + fillPath(endpoint) + buildQuery(endpoint);
  const sample = buildSampleBody(endpoint.requestBody);
  const hasBody = endpoint.requestBody !== undefined && Object.keys(sample).length > 0;
  const bodyMin = JSON.stringify(sample);
  const bodyPretty = JSON.stringify(sample, null, 2)
    .split('\n')
    .map((l, i) => (i === 0 ? l : '  ' + l))
    .join('\n');

  switch (lang) {
    case 'curl':
      return buildCurl(endpoint, url, hasBody, bodyMin);
    case 'js':
      return buildJs(endpoint, url, hasBody, bodyPretty);
    case 'python':
      return buildPython(endpoint, url, hasBody, bodyMin);
  }
}

export const CURL_AUTH = [
  'curl ' + BASE + '/api/v1/contacts ' + BS,
  '  -H "Authorization: Bearer ' + KEY_PLACEHOLDER + '"',
].join('\n');

export const WEBHOOK_VERIFY = [
  '// Verificacao da assinatura HMAC (Node.js)',
  'import crypto from "node:crypto";',
  '',
  'function verify(rawBody, signatureHeader, secret) {',
  '  const expected = crypto.createHmac("sha256", secret)',
  '    .update(rawBody)',
  '    .digest("hex");',
  '  return crypto.timingSafeEqual(',
  '    Buffer.from(signatureHeader),',
  '    Buffer.from(expected),',
  '  );',
  '}',
].join('\n');

// Snippets estaticos da secao "Exemplos" (sections.tsx), mantidos por compat.
export const CURL = [
  'curl -X POST ' + BASE + '/api/v1/conversions ' + BS,
  '  -H "Authorization: Bearer ' + KEY_PLACEHOLDER + '" ' + BS,
  '  -H "Content-Type: application/json" ' + BS,
  '  -d ' +
    String.fromCharCode(39) +
    '{"contactId":"...","conversionTypeKey":"venda","valueCents":19900}' +
    String.fromCharCode(39),
].join('\n');

export const JS = [
  'const res = await fetch(' + String.fromCharCode(39) + BASE + '/api/v1/conversions' + String.fromCharCode(39) + ', {',
  '  method: "POST",',
  '  headers: {',
  '    Authorization: ' + TICK + 'Bearer ' + DOLLAR + '{process.env.LEADIUM_API_KEY}' + TICK + ',',
  '    "Content-Type": "application/json",',
  '  },',
  '  body: JSON.stringify({ contactId: "...", conversionTypeKey: "venda", valueCents: 19900 }),',
  '});',
  'const data = await res.json();',
].join('\n');

export const PY = [
  'import os, requests',
  '',
  'res = requests.post(',
  '    ' + String.fromCharCode(39) + BASE + '/api/v1/conversions' + String.fromCharCode(39) + ',',
  '    headers={"Authorization": f"Bearer {os.environ[' + String.fromCharCode(39) + 'LEADIUM_API_KEY' + String.fromCharCode(39) + ']}"},',
  '    json={"contactId": "...", "conversionTypeKey": "venda", "valueCents": 19900},',
  ')',
  'data = res.json()',
].join('\n');
