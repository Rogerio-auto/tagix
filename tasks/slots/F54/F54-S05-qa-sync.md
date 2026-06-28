---
id: F54-S05
title: QA + adversarial da sincronização bidirecional Cockpit ↔ Agenda
phase: F54
status: done
priority: medium
estimated_size: M
depends_on: [F54-S02, F54-S03, F54-S04]
agent_id: qa-engineer
source_docs:
  - docs/features/AGENDA_SYNC.md
completed_at: 2026-06-28T20:31:46Z

---
# F54-S05 — QA + adversarial da sincronização

## Objetivo

Garantir que a sincronização bidirecional Cockpit ↔ Agenda é confiável: sem perder eventos, sem
duplicar, sem vazar visibilidade, resiliente a reconexão de socket.

## Contexto

S01 emite `event:*` no relay; S02 invalida o cache; S03 renderiza a lista/cartões; S04 cobre a
automação. Esta é a passada de qualidade da fase (integração + adversarial). e2e não roda verde
neste host (memória `e2e-no-hydration-this-host`).

## Escopo

### files_allowed
- `apps/api/src/routes/calendar/__tests__/**`
- `apps/workers/src/automations/__tests__/**`
- `apps/web/features/calendar/__tests__/**`
- `tasks/COMMS.md` (registrar achados que exijam sub-slot)

### files_forbidden
- Código de produção (este slot é teste/relatório). Achou bug? Registra em COMMS e/ou abre sub-slot;
  NÃO conserta fora de teste sem combinar.

## Escopo (faz)
- Integração backend: emit chamado em create/update/cancel; payload da listagem inclui `contact`;
  visibilidade não regride (evento de calendário inacessível não aparece nem é emitido p/ quem não vê).
- Lógica frontend: invalidação por `event:*`; agrupamento por dia / ordenação / destaque vencidos+hoje
  (funções puras testáveis); estados empty/loading/error.
- Adversarial (caminhar nos limites): rajada de eventos (coalesce), reconexão de socket (resync),
  evento sem contato (`contact: null`), corrida criar+cancelar, duplicata de emit, fuso/virada de dia.
- Relatório dos gaps encontrados (severidade) em COMMS; o que for bug de produção vira sub-slot.

## Definition of Done
- [ ] Testes de integração/unit cobrindo emit, enriquecimento, invalidação e agrupamento.
- [ ] Lista adversarial de edge cases com veredito (coberto / gap / aceito).
- [ ] `pnpm typecheck`, `pnpm lint`, testes verdes; gaps de produção registrados.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web test
pnpm --filter @hm/workers test
```

## Notas
Foco em confiabilidade (o founder pediu sincronização robusta). e2e não valida neste host — cobrir por
integração/unit + revisão manual do raciocínio de corrida.
