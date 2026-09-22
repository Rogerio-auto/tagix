// Flat config (ESLint 9). Stack TS strict end-to-end — zero `any`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      // Worktrees efêmeras do harness multi-agente (clones do repo) não são fonte.
      '**/.claude/**',
      // Python (agent-runtime): virtualenv e caches não são JS do monorepo.
      '**/.venv/**',
      '**/__pycache__/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // CLAUDE.md global: TypeScript strict, zero `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // ── F61-S01 — service worker: outro runtime, outros globais.
  //
  // `sw.js` e `sw-strategy.js` não rodam no navegador nem no Node: rodam num
  // ServiceWorkerGlobalScope, onde `self`, `caches`, `fetch`, `Request` e
  // `Response` existem e `window`/`document` NÃO existem. Sem esta declaração o
  // `no-undef` acusa 24 erros em código correto — e um lint que erra sobre código
  // correto é um lint que as pessoas aprendem a ignorar.
  {
    files: ['apps/web/public/sw*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  // ── F59-S08 — regras vindas da proposta DS 3.0 §07 (docs/DESIGN_SYSTEM_V3_DELTA.md).
  //
  // As tres tratam do mesmo vicio: valor que deveria vir de configuracao aparecendo
  // dentro do componente. Cor vem de token semantico; moeda, fuso e idioma vem do
  // market pack. Sem lint, "nao faca hardcode" e recomendacao — e recomendacao nao
  // segura ninguem as 23h.
  //
  // Escopo: apenas UI (`apps/web`, `packages/ui`). Backend formata para log e para
  // provider, onde locale fixo e legitimo.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    rules: {
      // SEVERIDADE `warn`, nao `error`, por decisao medida (F59-S08): as quatro
      // regras acusam 109 ocorrencias no codigo existente (19 hex, 44 toLocaleX,
      // 32 Intl, 14 fuso). Subir para `error` agora travaria o CI de todo mundo
      // por divida que nao e deste slot. `warn` deixa a regra visivel e impede
      // que a divida CRESCA; a limpeza tem slot proprio (ver tasks/COMMS.md).
      // TODO(2026-09-09 · limpeza DS/i18n): promover para 'error' quando zerar.
      'no-restricted-syntax': [
        'warn',
        {
          // Cor literal em JSX/TSX: use os tokens semanticos do DS.
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Sem hex em componente. Use token semantico do DS (var(--bg), var(--brand), ...). Ver docs/DESIGN_SYSTEM.md.',
        },
        {
          // Locale literal em formatacao: o idioma vem do market pack do workspace.
          selector:
            "CallExpression[callee.property.name='toLocaleString'] > Literal:first-child, CallExpression[callee.property.name='toLocaleDateString'] > Literal:first-child, CallExpression[callee.property.name='toLocaleTimeString'] > Literal:first-child",
          message:
            'Locale literal em formatacao. O idioma vem do market pack (@hm/shared/markets), nao do componente.',
        },
        {
          // `new Intl.*('pt-BR')` / `('en-US')` — mesmo motivo.
          selector:
            "NewExpression[callee.object.name='Intl'] > Literal:first-child",
          message:
            'Locale literal em Intl. O idioma vem do market pack (@hm/shared/markets), nao do componente.',
        },
        {
          // Fuso IANA literal: vem do contato ou do market pack.
          selector: "Literal[value=/^(America|Europe|Asia|Africa|Australia|Pacific)\\/[A-Za-z_]+$/]",
          message:
            'Fuso literal em componente. O fuso vem do contato ou do market pack (@hm/shared/markets).',
        },
      ],
    },
  },
);
