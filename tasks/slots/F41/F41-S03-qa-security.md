---
id: F41-S03
title: QA + revisão de segurança do console (não misturar)
phase: F41
status: done
priority: high
estimated_size: S
depends_on:
  - F41-S01
  - F41-S02
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: qa-engineer
claimed_at: 2026-06-19T16:08:44Z
completed_at: 2026-06-19T16:14:17Z

---
# F41-S03 — QA + revisão de segurança

## Objetivo

Validar a referência rica e o console, com foco nos dois muros do "não misture" (SUPPORT.md §6.3). Caçar qualquer caminho onde sandbox toque a rede, modo real escreva, a API key vaze, ou superfície de plataforma/cross-tenant apareça.

## Contexto

S01 (referência) + S02 (console) implementados. Validação web por unit/typecheck/lint/build (e2e não hidrata neste host).

## Escopo (faz)

- **Muro 1 (Sandbox ⟂ rede):** confirmar que no Sandbox NENHUM fetch sai (mock 100% client-side). Teste unit do gerador de resposta mock + inspeção de que o código do modo sandbox não chama `fetch`/api-client.
- **Muro 2 (escopo/efeito):** modo real só habilita GET; endpoint de escrita no real é bloqueado e forçado a Sandbox. Nenhum endpoint de plataforma na referência (a fonte é `/api/v1/openapi.json`, mas confirmar). Sem caminho cross-tenant.
- **API key:** nunca em localStorage/sessionStorage/cookie; não logada; não enviada a lugar nenhum além do `Authorization` da request real; some ao desmontar.
- **Gerador de exemplo (S01):** snapshot/unit de que reflete o schema.
- Relatório priorizado em `tasks/COMMS.md` (append-only). Bug de produção → sub-slot, não corrige fora do files_allowed.

## Arquivos permitidos

- `apps/web/features/developers/**/*.test.ts`
- `apps/web/features/developers/**/*.test.tsx`
- `apps/web/e2e/**`
- `tasks/COMMS.md`

## Arquivos proibidos

- Código de produção (só testes).

## Definition of Done

- [ ] Provado: Sandbox não emite fetch; modo real não executa mutação; API key não persiste.
- [ ] Nenhuma superfície de plataforma/cross-tenant no portal.
- [ ] Achados (se houver) priorizados em COMMS.md; testes verdes (`pnpm typecheck` + `pnpm lint` + unit do @hm/web).

## Notas

Espelhe o rigor da auditoria da F38-S15. Os dois muros são o critério de aceitação do Rogério — qualquer furo é alto.
</content>
