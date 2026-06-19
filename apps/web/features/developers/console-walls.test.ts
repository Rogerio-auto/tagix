import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F41-S03 — prova, por inspecao do fonte, os dois muros do "nao misture"
 * (SUPPORT.md 6.3). Sao testes deliberadamente estruturais: se alguem introduzir
 * fetch no caminho Sandbox, persistir a API key ou abrir mutacao no Real, quebram.
 */

const dir = __dirname;
const console_ = readFileSync(join(dir, 'TryItConsole.tsx'), 'utf-8');
const snippets = readFileSync(join(dir, 'snippets.ts'), 'utf-8');
const openapi = readFileSync(join(dir, 'openapi.ts'), 'utf-8');

/** Remove comentarios (// e BLOCO) p/ checar uso REAL das APIs, nao mencao em doc. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}
const consoleCode = stripComments(console_);

/** Extrai o corpo de uma funcao top-level por nome (heuristica de chaves balanceadas). */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, 'assinatura ' + signature + ' nao encontrada').toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error('corpo de ' + signature + ' nao fechado');
}

describe('Muro 1 — Sandbox nunca toca a rede', () => {
  it('runSandbox nao chama fetch nem api-client', () => {
    const body = functionBody(console_, 'function runSandbox(');
    expect(body).not.toMatch(/\bfetch\s*\(/);
    expect(body).not.toContain('api.');
    expect(body).not.toContain('XMLHttpRequest');
    expect(body).not.toContain('navigator.sendBeacon');
  });

  it('runSandbox e sincrono (sem async/await => sem I/O)', () => {
    const decl = console_.slice(console_.indexOf('function runSandbox('));
    expect(decl.startsWith('function runSandbox(')).toBe(true);
    const body = functionBody(console_, 'function runSandbox(');
    expect(body).not.toContain('await');
  });

  it('existe exatamente um fetch no console, e dentro de runReal', () => {
    const fetchCount = (console_.match(/\bfetch\s*\(/g) ?? []).length;
    expect(fetchCount).toBe(1);
    const realBody = functionBody(console_, 'async function runReal(');
    expect(realBody).toMatch(/\bfetch\s*\(/);
  });
});

describe('Muro 2 — modo Real so executa GET, escopado pela chave', () => {
  it('runReal recusa metodo diferente de GET', () => {
    const body = functionBody(console_, 'async function runReal(');
    expect(body).toContain("endpoint.method !== 'get'");
    expect(body).toContain('throw');
    expect(body).toContain("method: 'GET'");
  });

  it('runReal usa credentials omit (nao mistura sessao por cookie)', () => {
    const body = functionBody(console_, 'async function runReal(');
    expect(body).toContain("credentials: 'omit'");
  });

  it('o componente desabilita o modo Real para mutacoes', () => {
    // effectiveMode forca sandbox quando isMutating; o toggle Real so aparece para !isMutating.
    expect(console_).toContain("const effectiveMode: Mode = isMutating ? 'sandbox' : mode;");
    expect(console_).toContain('{!isMutating && (');
  });
});

describe('Muro 2 — API key vive so em memoria', () => {
  it('nao persiste a chave em storage nem cookie (uso real, ignorando comentarios)', () => {
    expect(consoleCode).not.toMatch(/localStorage\s*[.[]/);
    expect(consoleCode).not.toMatch(/sessionStorage\s*[.[]/);
    expect(consoleCode).not.toContain('document.cookie');
    expect(consoleCode).not.toMatch(/indexedDB\s*\./);
  });

  it('nao registra a chave em log', () => {
    expect(consoleCode).not.toMatch(/console\.\w+/);
  });

  it('a chave so flui para o header Authorization da request real', () => {
    const body = functionBody(console_, 'async function runReal(');
    expect(body).toContain("Authorization: 'Bearer ' + apiKey");
  });
});

describe('Sem superficie de plataforma/cross-tenant', () => {
  it('a referencia consome apenas /api/v1/openapi.json (publico, tenant-scoped)', () => {
    expect(openapi).toContain("'/api/v1/openapi.json'");
    expect(openapi).not.toContain('/platform');
    expect(openapi).not.toContain('/api/help');
    expect(openapi).not.toContain('/api/support');
  });

  it('o gerador de exemplo nao referencia endpoints de plataforma', () => {
    expect(snippets).not.toContain('/platform');
  });
});
