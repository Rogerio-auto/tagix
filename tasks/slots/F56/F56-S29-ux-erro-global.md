---
id: F56-S29
title: UX — helper único de erro derivado de ApiError (status + ref)
phase: F56
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S29 — Erro acionável e consistente (UX-17/UX-04)

> **Origem:** AUDITORIA_TECNICA.md §3.5. Dezenas de telas mostram "conexão falhou" para 401/403/500/rede; `ApiError.status/ref` só é usado no composer. Sessão expirada (o caso mais comum) vira "problema de conexão".

## Objetivo

Prover um helper único que deriva mensagem+ação de `ApiError.status` e sempre expõe o `ref`, para as telas pararem de mascarar a causa.

## Contexto / causa raiz (verificada)

`DashboardClient.tsx:223`, `ChatList.tsx:132`, `ContactsPage.tsx:283`, `ConversionsPage.tsx:181`, `CampaignsPage.tsx:221` — literais fixos; `ApiError` carrega `status`/`ref` não usados.

## Escopo (faz)

- `apps/web/shared/lib/api-error-message.ts`: mapeia `ApiError.status` → `{reason, whatToDo, ref}` (401→relogar+CTA; 403→sem permissão; 5xx/rede→tentar de novo).
- Integrar o helper ao `ErrorState` compartilhado em `apps/web/shared/components/feedback/**` (a superfície de renderização), sempre exibindo o `ref`.

## Escopo (não faz)

- Adoção per-tela em cada feature (follow-up; colide com slots de feature).
- Primitivo `@hm/ui/ErrorState` (F56-S26 — outro package, disjunto).

## Arquivos permitidos

- `apps/web/shared/lib/api-error-message.ts`
- `apps/web/shared/lib/index.ts`
- `apps/web/shared/components/feedback/ErrorState.tsx`

## Arquivos proibidos

- `apps/web/shared/components/feedback/{EmptyState,Skeleton}.tsx` · `apps/web/features/**`

## Definition of Done

- [ ] Helper cobre 401/403/404/5xx/rede com mensagem+ação distintas e `ref`.
- [ ] `ErrorState` compartilhado usa o helper e mostra o `ref`.
- [ ] Testes unitários do mapeamento.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/UX_PRINCIPLES.md)

- 401 → "sua sessão expirou, entre de novo" com CTA, não "conexão falhou".
- Sempre expor o `ref` copiável (reduz ticket de suporte).
- Distinguir empty (sem dado) de erro (falha) — não fabricar zeros.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Este slot entrega o helper + a superfície compartilhada; a troca dos literais em cada feature é um follow-up de sweep (documentado na auditoria, Épico 6).
