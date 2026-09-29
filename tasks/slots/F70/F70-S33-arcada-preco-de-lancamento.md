---
id: F70-S33
title: Agente da Arcada com preço de lançamento, pagamento por nível e prazo de 5 dias úteis
phase: F70
status: in-progress
priority: critical
estimated_size: M
depends_on: [F70-S06, F70-S31]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
  - ../rogerio-os/vault/04-projetos/arcada.md
  - ../portfolio-sites/planejamento/niveis-odonto/PLANO.md
agent_id: backend-engineer
claimed_at: 2026-09-29T16:20:44Z

---
# F70-S33 — Agente da Arcada com preço de lançamento

## Contexto (decisões do Rogério, 29/09/2026)

A Arcada passa a vender com **preço de lançamento**: Essencial R$ 297, Estúdio R$ 397, Cinema R$ 999 (antes R$ 1.000 / 2.500 / 5.000). É condição verdadeira: os valores sobem quando houver casos entregues e depoimentos. Rogério OS e Hermes já foram atualizados.

## Escopo

### files_allowed

- `packages/db/src/seed/agent_templates_arcada*.ts`
- `packages/db/src/seed/tools_agent_grants.ts`
- `tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md`

## Escopo (faz)

- `ARCADA_TIERS`: 297 / 397 / 999, com o nome do nível (Essencial, Estúdio, Cinema). Marcadores `nivel_1000_inclui` / `nivel_2500_inclui` / `nivel_5000_inclui` viram `nivel_essencial_inclui` / `nivel_estudio_inclui` / `nivel_cinema_inclui`.
- **Pagamento (substitui os limites de 24/09):**
  - sem desconto em nenhum nível, nem à vista, nem negociando;
  - Essencial e Estúdio: só à vista;
  - Cinema: à vista ou 2 parcelas iguais (2 × R$ 499,50), nunca mais que 2x;
  - `maxInstallments` por nível (1 / 1 / 2); saem `cashDiscountPct` e `maxCashDiscountPct` do prompt e da KB;
  - pedido de desconto: o agente explica, sem pressão, que é o valor de lançamento e não tem desconto. Se insistir, ou pedir parcelamento fora disso, é handoff pelo gatilho `out_of_limits`.
- **Prazo:** entrega final em até 5 dias úteis em todos os níveis (`deliveryBusinessDays = 5`), contados do recebimento do material completo, com o CRO do responsável técnico. `inicio_do_prazo` pré-preenchido com isso, para aprovação. Nunca prometer prazo menor.
- Prompt e KB: "valor de lançamento, enquanto a Arcada monta os primeiros casos". Nunca inventar prazo para a promoção, urgência, escassez ou "últimas vagas".
- **Pré-preenchido em rascunho**, para aprovação: o que cada nível inclui, a partir de `rogerio-os/vault/04-projetos/arcada.md` e `portfolio-sites/planejamento/niveis-odonto/PLANO.md`. `links_do_portfolio`: https://arcada-sandy.vercel.app e as demos (Aline Tenório = Essencial, Quadrante = Estúdio, Nácar = Cinema, todas "projeto conceito"). O que não estiver nesses arquivos continua marcador.
- Modelos da cadência (nomes definidos pelo Rogério; aprovação na Meta pendente): `modelo_lembrete_dia_3 = arcada_lembrete_dia_3`, `modelo_lembrete_dia_7 = arcada_lembrete_dia_7`, `modelo_toque_30_dias = arcada_toque_30_dias`; envio sem parâmetros.
- Seed idempotente gera a v2 (prompt, KB) como rascunho; o agente continua **inativo**.

## Definition of Done

- [ ] testes: preços e nomes dos níveis; marcadores novos; parcelas por nível (Cinema 2 × R$ 499,50; os outros sem parcelamento); nenhuma oferta de desconto no texto gerado (prompt e KB)
- [ ] seed no dev: v2 em rascunho, live intocado, agente inativo, 2ª rodada sem criar nada
- [ ] F70-S06 atualizado (decisões de 29/09)
