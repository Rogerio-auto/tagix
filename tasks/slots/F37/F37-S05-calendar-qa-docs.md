---
id: F37-S05
title: Calendar 2.0 — QA + audit (regressão do vazamento) + docs
phase: F37
status: blocked
priority: medium
estimated_size: M
depends_on:
  - F37-S02
  - F37-S03
  - F37-S04
blocks: []
source_docs:
  - docs/features/CALENDAR_V2_PLAN.md
agent_id: qa-engineer
---
# F37-S05 — QA + audit + docs

## Objetivo

Fechar a F37: e2e dos fluxos-chave, auditoria de visibilidade (regressão do vazamento L1) e consolidação da documentação.

## Contexto

Slot de fechamento; depende da API (S02) + UI desktop (S03) + mobile (S04). O ponto crítico é provar que a visibilidade está correta (cada um vê o seu + Empresa; owner vê todos; membro comum NÃO vê pessoal de colega).

## Escopo (faz)

- **`apps/web/e2e/calendar-v2.spec.ts`** (novo) — fluxos determinísticos: trilha liga/desliga calendários (overlay), criar evento (incl. recorrente) por arraste, mover/redimensionar, abrir detalhe/RSVP. (Honestidade de ambiente: se o host não hidrata e2e, validar specs por typecheck + cobrir o resto por unit/integration; não inventar verde — ver memória do projeto.)
- **`docs/audits/CALENDAR_V2_AUDIT.md`** (novo) — varredura de **visibilidade**: como membro comum, supervisor, admin e owner — confirmar via API (cookies, login dev) que cada um só recebe os calendários/eventos que deve; registrar a regressão do vazamento L1 fechada. Checklist de UX (UX_PRINCIPLES §4) na tela.
- **`docs/features/CALENDAR.md`** — atualizar para o modelo 2.0 (visibilidade, multi-calendário, recorrência, provisionamento). Notar que a §3.1 antiga é superada pela migration (gotcha F7).

## Fora de escopo

- Implementação (volta como follow-up ao slot dono se achar bug).

## Arquivos permitidos

- `apps/web/e2e/calendar-v2.spec.ts`
- `docs/audits/CALENDAR_V2_AUDIT.md`
- `docs/features/CALENDAR.md`

## Arquivos proibidos

- Qualquer arquivo de implementação (S01–S04)

## Definition of Done

- [ ] Auditoria de visibilidade prova: membro comum NÃO vê pessoal de colega; owner vê todos; supervisor vê seus times; cada um vê Empresa.
- [ ] e2e cobre os fluxos-chave (ou documenta honestamente o pendente de ambiente).
- [ ] `CALENDAR.md` reflete o 2.0.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Notas

Use a receita de login dev (mock + owner@dev.local + seed-demo) para a auditoria de visibilidade via API — testar com membros de roles diferentes (criar/usar membros AGENT/SUPERVISOR no workspace de teste).
