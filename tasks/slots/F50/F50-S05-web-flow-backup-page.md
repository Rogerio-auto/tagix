---
id: F50-S05
title: UI — item na sidebar + página de Backup de Flows (export/import)
phase: F50
status: in-progress
priority: high
estimated_size: M
depends_on: [F50-S02, F50-S04]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-26T20:00:42Z

---
# F50-S05 — Sidebar + página de Backup de Flows

## Objetivo

Adicionar o item "Backup de Flows" na sidebar (grupo Gerenciar, gated por `flow.backup`) e a página
`/flows/backup` com Exportar (download) e Importar (seleção de arquivo → preview → confirmação),
seguindo o DS v2 e UX premium.

## Contexto

Consome as rotas de S04 e a permissão de S02. Decisão aprovada: página dedicada (escala p/ histórico/
auto-backup futuros). Import mostra resumo e exige confirmação (anti-duplicação/segurança).

## Escopo (faz)

- `apps/web/shared/components/layout/nav.ts`: item `{ href:'/flows/backup', label:'Backup de Flows',
  icon: DatabaseBackup, group:'manage', perm:'flow.backup' }` (importar o ícone lucide).
- `apps/web/app/(app)/flows/backup/page.tsx`: RSC shell (`metadata`, container padrão).
- `apps/web/features/flow-builder/backup/`:
  - `types.ts`: re-export de tipos de `@hm/flow-engine` (`BackupEnvelope`, `PreviewResult`, `ImportResult`).
  - `queries.ts`: `useExportFlows` (GET → Blob + `URL.createObjectURL` + `<a download>`),
    `usePreviewImport` (POST preview), `useImportFlows` (POST import; onSuccess invalida a lista de flows).
  - `BackupPage.tsx`: `PageHeader` + 2 cards `@hm/ui` (Exportar: botão→download+toast; Importar:
    `<input type=file>` → `FileReader.readAsText` → `JSON.parse` → preview → abre modal). Gate por
    `can(role,'flow.backup')`; `Button loading`; `useToast` success/error.
  - `ImportPreviewModal.tsx`: `Modal` com resumo do `PreviewResult` (nº flows, nós, colisões de nome,
    refs resolvidas vs não-resolvidas, avisos de versão, checksum válido). Footer Cancelar / Confirmar
    (passa `confirmedChecksum`). Progresso/spinner nas mutations; toast final com created/skipped.

## Fora de escopo

- Endpoints (S04). Lógica de referências (S01/S03).

## Arquivos permitidos

- `apps/web/shared/components/layout/nav.ts`
- `apps/web/app/(app)/flows/backup/**`
- `apps/web/features/flow-builder/backup/**`

## Arquivos proibidos

- `apps/web/features/flow-builder/**` exceto `backup/**`
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Item "Backup de Flows" aparece na sidebar só para OWNER/ADMIN (grupo Gerenciar).
- [ ] Exportar baixa o JSON (toast de sucesso); nome `leadium-flows-backup-<data>.json`.
- [ ] Importar: seleciona arquivo → preview com resumo claro → confirma → toast com resultado;
      arquivo inválido/checksum quebrado → erro claro (não importa).
- [ ] Sem hex hardcoded; tokens DS v2; estados de loading/disabled (anti-duplo-clique).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web test` verdes; build do web ok.

## UX considerations

- **Estado honesto (UX_PRINCIPLES §2):** mostrar refs que NÃO resolvem ANTES de confirmar; nada de
  importar silenciosamente com referências quebradas.
- **Confirmação de ação relevante (§3):** import passa por modal de resumo + confirmação explícita.
- **Progresso visível:** spinners/indicadores durante export/preview/import.

## Permission scope

- Página e ações exigem `flow.backup` (OWNER/ADMIN). Ver S02.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- e2e não hidrata neste host ([[e2e-no-hydration-this-host]]) → validar por typecheck/lint/test/build.
- Reusar padrão de download (Blob/createObjectURL) e `useToast`/`Modal` já existentes.
