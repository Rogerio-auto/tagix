---
id: F39-S05
title: Validação E2E Meta + runbook de conexão WhatsApp/coexistência
phase: F39
status: done
priority: medium
estimated_size: M
depends_on: [F39-S01, F39-S02, F39-S03, F39-S04]
agent_id: qa-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/runbooks/deploy-production.md
blocks: []
claimed_at: 2026-06-19T05:34:05Z
completed_at: 2026-06-19T05:41:07Z

---
# F39-S05 — Validação E2E Meta + runbook de conexão

> **source_docs:** `docs/features/INSTAGRAM.md` (fluxo análogo) · `docs/runbooks/deploy-production.md`
> **depende de:** F39-S01..S04 (feature completa)

## Objetivo

Fechar a fase com (1) **teste de integração** ponta-a-ponta do connect WhatsApp + ingestão de coexistência (Graph e webhook mockados) e (2) um **runbook operacional** descrevendo como conectar um número WABA real (Cloud API e coexistência), configurar webhook na Meta, e validar inbound/echo/history.

## Contexto

A feature toca onboarding (S01), UI (S02), ingestão (S03) e workers (S04). Falta a camada de validação E2E e a documentação de operação para conectar um número real (incluindo a config do webhook e dos secrets feita na Onda 0).

## Escopo (faz)

- `apps/web/e2e/specs/whatsapp-coexistence.spec.ts` (novo): jornada de connect (mockando FB Login/Graph) + verificação de canal ativo; smoke da ingestão.
- `docs/runbooks/connect-whatsapp-coexistence.md` (novo): passo-a-passo — pré-requisitos (App ID/Secret/verify token), config do webhook na Meta (campos `messages` + coexistência), connect via wizard, e checklist de validação (handshake, inbound real, echo do app, history).

## Fora de escopo

- Qualquer mudança em código de produção de S01–S04 (este slot é validação + docs). Bugs encontrados viram sub-slots.

## Arquivos permitidos

- `apps/web/e2e/specs/whatsapp-coexistence.spec.ts`
- `docs/runbooks/connect-whatsapp-coexistence.md`

## Arquivos proibidos

- Todo o resto (slot de validação/docs — não edita produção).

## Definition of Done

- [ ] Spec E2E cobre o connect WA (mock) e o caminho feliz de ingestão (echo/history) com asserts claros.
- [ ] Runbook completo e reproduzível: um operador consegue conectar um número e validar inbound/echo/history seguindo os passos.
- [ ] `pnpm --filter @hm/web typecheck` + `pnpm lint` verdes (a suíte e2e não roda verde neste host — validar por typecheck/lint/build; ver memória `e2e-no-hydration-this-host`).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **qa-engineer**. e2e Playwright não hidrata no host Windows local — o valor aqui é o spec autorado + o runbook; a execução verde fica para CI/Linux.
- A validação com número WABA **real** depende de o Rogério conectar um número (a Onda 0 já deixou webhook + secrets prontos). Documentar isso como passo manual no runbook.
