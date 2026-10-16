---
id: F75-S15
title: QA da F75 — jornada ponta a ponta, lacunas de teste, acessibilidade e portão de design
phase: F75
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F75-S10, F75-S11, F75-S13]
blocks: []
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/design/copilot-integracoes-ux.md
agent_id: qa-engineer
---
# F75-S15 — QA e portão de design

## Objetivo

A Loja de Integrações funciona de ponta a ponta contra serviços reais do dev (Postgres, Redis, RabbitMQ, workers),
sem lacunas óbvias de teste, acessível nos dois temas, e aprovada no portão de gosto contra a maquete.

## Contexto

Último slot da F75. Rodar `/hm-qa` e, para a interface, `/hm-designer`. Correções que exigirem código fora dos
arquivos abaixo viram slots novos.

## Escopo (faz)

- e2e **sem mock de API** (dev stack completo) `apps/web/e2e/specs/integrations-journey.spec.ts`:
  1. abrir a Loja, buscar "estoque", abrir o detalhe;
  2. "Conectar qualquer sistema": gerar endereço e chave, enviar `negocio.criar` por `fetch` real com a chave,
     ver o evento chegar no teste ao vivo e o contato+negócio no Pipeline;
  3. importar a planilha de fixture (CSV `;` Latin-1 com 20 linhas, 2 com telefone sem DDD e 1 código `000123`):
     mapear (heurística, agent-runtime desligado), testar, aplicar a correção de DDD, importar, conferir o
     relatório e o código preservado;
  4. conectar `generic-rest` contra um servidor fake local (allowlist de dev), sincronizar, quebrar o fake (500),
     ver a Atenção com causa na Loja e no painel, reprocessar depois de consertar;
  5. desconectar e conferir o que ficou.
- Lacunas: cobertura dos serviços `apps/api/src/services/integrations/**` e de `apps/workers/src/integrations/**`
  (relatório; meta ≥ 80% de linhas nos serviços); testes de borda faltantes viram testes aqui se couberem nos
  arquivos permitidos.
- Acessibilidade: `expectNoSeriousAxe` em `/integracoes`, detalhe, assistente (5 passos), painel e qualquer
  sistema, nos dois temas; navegação só por teclado na jornada 1–3.
- Capturas finais 375/768/1440 × dark/light de todas as telas em `apps/web/e2e/.artifacts/f75-s15/` e
  comparação lado a lado com `docs/design/copilot-integracoes/`.
- `/hm-designer` sobre as capturas: veredito com correções de valor exato; reprovação abre slot de ajuste.
- Desempenho: peso das rotas `/integracoes*` (First Load JS) e INP nas interações da Loja e do assistente.

### files_allowed

- `apps/web/e2e/specs/integrations-journey.spec.ts`
- `apps/web/e2e/fixtures/integrations/**`
- `apps/web/e2e/.artifacts/f75-s15/**`
- `tasks/slots/F75/F75-S15-qa-e2e-e-portao-de-design.md`

## Definition of Done

- [ ] jornada 1–5 verde contra o stack de dev (`--workers=1`), duas rodadas seguidas
- [ ] axe sem violação séria em todas as telas, dois temas
- [ ] relatório de cobertura e de lacunas nas notas do slot
- [ ] veredito `/hm-designer` APROVADO (ou slots de ajuste criados e listados)
- [ ] peso e INP registrados nas notas

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec playwright test e2e/specs/integrations-journey.spec.ts --workers=1
```

## Notas

- Agente: `qa-engineer`. Precisa de Docker Desktop com a infra de dev (`infra/docker/docker-compose.dev.yml`),
  API, workers e web de pé.
