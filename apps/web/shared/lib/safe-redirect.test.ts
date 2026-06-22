import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it('aceita caminhos internos', () => {
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/inbox')).toBe('/inbox');
    expect(safeNextPath('/settings/billing?tab=x#f')).toBe('/settings/billing?tab=x#f');
  });
  it('rejeita protocol-relative //host', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('//evil.com/path')).toBe('/');
  });
  it('rejeita URLs absolutas externas', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('http://evil.com/x')).toBe('/');
  });
  it('rejeita esquemas perigosos', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath('data:text/html,x')).toBe('/');
  });
  it('rejeita backslash tricks', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('\\\\evil.com')).toBe('/');
    expect(safeNextPath('/foo\\bar')).toBe('/');
  });
  it('rejeita vazio/null/nao-string', () => {
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath('relative/no/slash')).toBe('/');
  });
  it('respeita fallback customizado', () => {
    expect(safeNextPath('//evil.com', '/login')).toBe('/login');
  });
  it('rejeita caracteres de controle', () => {
    expect(safeNextPath('/foo\nbar')).toBe('/');
  });
});
