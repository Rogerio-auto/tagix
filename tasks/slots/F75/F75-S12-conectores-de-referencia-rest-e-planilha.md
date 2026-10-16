---
id: F75-S12
title: Conectores de referência — API REST genérica por polling e importação de CSV/planilha com relatório
phase: F75
status: blocked
priority: high
estimated_size: M
model: sonnet
depends_on: [F75-S04, F75-S05, F75-S06]
blocks: [F75-S10, F75-S13]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
agent_id: backend-engineer
---
# F75-S12 — Conectores de referência

## Objetivo

Dois conectores reais provam o framework de ponta a ponta: **API REST genérica** (a empresa informa URL base,
chave e caminhos; o Leadium faz polling paginado e incremental) e **Planilha e CSV** (a pessoa sobe um arquivo,
mapeia, testa com 5 linhas e importa com um relatório: criados, atualizados, ignorados com motivo, corrigidos).

## Contexto

Spec §1 e §4.1 (modos `api_key` e `file_upload`). Os manifestos já existem no catálogo (S02). Hoje o único import
de CSV do produto é o de público de campanha (`apps/api/src/routes/campaigns/recipients.ts`), sem relatório nem
mapeamento. Depende do S06 só porque os dois tocam o registro de conectores (`connectors/index.ts`).

## Escopo (faz)

- `packages/integrations/src/connectors/generic-rest/`: config (Zod) `{ baseUrl (https), auth: bearer|header
  { name }, entities: [{ entity, path, listField, cursor: { kind: 'page'|'cursor'|'updated_since', param,
  nextField? }, keyField, scopeField?, updatedAtField? }] }`; `pull` paginado com detecção de truncamento,
  `detectError` composto com o padrão, `sample`, `auth.test` (GET do primeiro path com `limit=1`),
  `runConformance` com `fakeRest`. Toda chamada por `ctx.fetch` (SSRF guard).
- `packages/integrations/src/connectors/csv-import/`: `file_upload`; o "cursor" é o número da linha; `pull` lê o
  arquivo do storage em streaming, 500 linhas por página; CSV por `csv-parse` (detecção de separador `;`/`,` e
  encoding UTF-8/Latin-1 com BOM), XLSX por `exceljs` em modo streaming (**proibido** o pacote `xlsx` do npm,
  versão abandonada com CVE); limites: 10 MB, 50 mil linhas, 100 colunas, célula ≤ 4 KB, descompressão XLSX
  ≤ 50 MB; cabeçalho vira `FieldSpec[]` para o mapeamento; cada linha tem `externalId` = coluna-chave escolhida
  (texto) ou `linha:<n>` quando não houver.
- Registro dos dois no `packages/integrations/src/connectors/index.ts`.
- Upload: `apps/api/src/services/integrations/uploads.ts` + `apps/api/src/routes/integrations/uploads.ts` (criado
  vazio pelo S07): `POST /api/integrations/connections/:id/upload` (multipart, `integration.manage`, valida tipo
  pelo conteúdo e não pela extensão, guarda via `@hm/storage` em chave privada por workspace, devolve
  `{ fileId, columns, rowCount, preview: 5 linhas }`); o arquivo some 7 dias após a importação.
- Relatório da importação: ao fim do run `initial` de uma conexão `csv-import`, `counts` + motivos agrupados já
  ficam em `sync_runs`/`sync_errors` (S04); expor `GET /api/integrations/connections/:id/import-report` com
  `{ created, updated, skipped, fixed, reasons[] }` e CSV de linhas rejeitadas para baixar (com proteção contra
  CSV injection: prefixo `'` em células iniciadas por `= + - @`).

## Fora de escopo

- UI (S10). Conectores de marca.

### files_allowed

- `packages/integrations/src/connectors/generic-rest/**`
- `packages/integrations/src/connectors/csv-import/**`
- `packages/integrations/src/connectors/index.ts`
- `packages/integrations/package.json`
- `pnpm-lock.yaml`
- `apps/api/src/services/integrations/uploads.ts`
- `apps/api/src/services/integrations/uploads.test.ts`
- `apps/api/src/routes/integrations/uploads.ts`

## Definition of Done

- [ ] `runConformance` verde nos dois conectores
- [ ] teste: REST com 3 páginas por cursor + `updated_since` incremental; página cheia sem cursor ⇒ truncado
- [ ] teste: REST apontando para `http://169.254.169.254` ou host que resolve para IP privado ⇒ bloqueado
- [ ] teste: CSV `;` Latin-1 com BOM e XLSX importam igual; código `000123` preservado
- [ ] teste: arquivo de 11 MB, 50.001 linhas e XLSX "zip bomb" ⇒ recusados com mensagem clara
- [ ] teste: relatório com criados/atualizados/ignorados/corrigidos e CSV de rejeitados com célula `=CMD()`
      neutralizada
- [ ] lockfile por `corepack pnpm@11.5.2 install`

## Validação

```bash
corepack pnpm@11.5.2 install --frozen-lockfile
pnpm --filter @hm/integrations typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/integrations exec vitest run src/connectors --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations/uploads.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. A rota de relatório pode morar em `uploads.ts` (mesmo router) para não abrir
  arquivo novo no índice.
