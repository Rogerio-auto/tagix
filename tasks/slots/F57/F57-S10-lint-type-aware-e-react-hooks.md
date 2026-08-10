---
id: F57-S10
title: Lint type-aware (no-floating-promises) + react-hooks no apps/web
phase: F57
status: available
priority: medium
estimated_size: L
depends_on: [F57-S01]
blocks: []
agent_id: frontend-engineer
source_docs:
  - eslint.config.mjs
  - landing/eslint.config.js
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S10 — O linter não vê a classe de bug que este stack produz

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). Os gates de tipo estão
> impecáveis (`strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature`,
> zero `any`, zero `@ts-ignore` em 1.512 arquivos). O linter é que está aquém deles.

## Objetivo

Fazer o ESLint cobrir promise não-aguardada e regras de hooks — as duas classes de
defeito que mais custam neste stack e que hoje passam limpas.

## Contexto / causa raiz (verificada)

### 1. Lint sem informação de tipo

`eslint.config.mjs:21` usa `...tseslint.configs.recommended` — a variante **sem**
type-checking. Ficam de fora, entre outras:

- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/await-thenable`
- `@typescript-eslint/require-await`

Num backend de 5 consumers RabbitMQ + Socket.io + scheduler, promise não-aguardada é
**a** causa clássica de "mensagem de cliente desapareceu sem erro no log": o `ack`
acontece, o trabalho não. É exatamente o sintoma recorrente registrado no histórico
do projeto. A regra é gratuita e o repo já tem toda a config de tipos necessária.

### 2. `apps/web` (React 19, ~69k LOC) sem `react-hooks`

Nenhum plugin de React no config da raiz. Não há `eslint-plugin-react-hooks` nem
`eslint-config-next` em nenhum `package.json` de `apps/` ou `packages/`.

E a ironia mede o gap: **`landing/`** — um app Vite estático, a menor superfície do
repo — **tem** `react-hooks` configurado (`landing/eslint.config.js:11`, via
`reactHooks.configs.flat.recommended`). O produto de verdade não.

Sem `react-hooks/exhaustive-deps` e `rules-of-hooks`: dependência faltando em
`useEffect` (stale data, listener duplicado de socket), hook em condicional, cleanup
ausente em subscription de realtime — nada disso é detectado.

### 3. Todo arquivo de config fora do lint

`eslint.config.mjs:19` ignora `'**/*.config.{js,mjs,cjs,ts}'` — logo
`next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `tailwind.config.js`
e `drizzle.config.ts` não são verificados. Configuração é código e quebra em produção
como qualquer outro.

## Escopo (faz)

- Migrar para `tseslint.configs.recommendedTypeChecked` (ou
  `strictTypeChecked`) com `projectService`, aplicado a `apps/**` e `packages/**`.
- Adicionar `eslint-plugin-react-hooks` para `apps/web/**` e `packages/ui/**`.
- Reduzir o ignore de configs: verificar os configs com um bloco mais frouxo em vez
  de excluí-los inteiros.
- Corrigir **todas** as violações apontadas. Onde uma promise for intencionalmente
  fire-and-forget, marcar com `void` explícito (não com `eslint-disable`).
- Se o volume for grande, quebrar em sub-slots por package (`F57-S10a` api,
  `F57-S10b` workers, …) — o repo tem só 5 `eslint-disable` hoje e essa disciplina
  não pode ser diluída por um lote grande demais para revisar.

## Escopo (não faz)

- Regras de estilo/formatação (Prettier já cobre).
- `import/no-cycle` (a auditoria de 2026-07 confirmou zero ciclos; não é dívida ativa).

## Arquivos permitidos

- `eslint.config.mjs`
- `package.json`
- `apps/*/src/**`
- `apps/web/app/**`
- `apps/web/features/**`
- `apps/web/shared/**`
- `packages/*/src/**`
- `*.config.ts`
- `apps/*/*.config.ts`
- `packages/*/*.config.ts`

## Arquivos proibidos

- `packages/db/drizzle/**`
- `landing/**` (já correto — não regredir)

## Definition of Done

- [ ] `pnpm lint` exit **0** com `recommendedTypeChecked` + `react-hooks` ativos.
- [ ] `no-floating-promises`, `no-misused-promises`, `await-thenable`,
      `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps` como **error**.
- [ ] Contagem de `eslint-disable` no repo **não cresce** além de 5 sem justificativa
      escrita inline em cada nova ocorrência.
- [ ] Configs de build cobertos pelo lint.
- [ ] `pnpm typecheck` + `pnpm -r test` continuam verdes (nenhum "conserto" de lint
      mudou comportamento).

## Validação

```bash
pnpm lint
pnpm typecheck
pnpm -r --if-present test
```

## Notas

- Lint type-aware é mais lento. Se o tempo de CI doer, use `projectService: true`
  (bem mais rápido que `project: [...]`) e cache do ESLint — **não** desligue regras.
- Cada violação de `no-floating-promises` encontrada é um bug potencial de perda de
  mensagem. Vale registrar as achadas em `tasks/COMMS.md`: elas indicam onde a malha
  assíncrona é frágil, mesmo depois de corrigidas.
