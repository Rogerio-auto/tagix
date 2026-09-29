---
id: F70-S33
title: Agente da Arcada com preço de lançamento, pagamento por nível e prazo de 5 dias úteis
phase: F70
status: review
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
completed_at: 2026-09-29T16:56:59Z

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

## Entregue

- `agent_templates_arcada.content.ts`: `ARCADA_TIERS` (chave, nome, preço, `maxInstallments`, marcador,
  demo), `ARCADA_TIER_INCLUDES` (pré-preenchido), `ARCADA_ALL_TIERS_INCLUDE`, frases únicas
  `ARCADA_LAUNCH_PRICE_PHRASE`, `ARCADA_NO_DISCOUNT`, `ARCADA_DELIVERY_COMMITMENT`,
  `ARCADA_NO_PRESSURE_RULE`; `ARCADA_PREFILLED_FOR_APPROVAL`; nomes dos modelos em `ARCADA_CADENCE`.
- `agent_templates_arcada.ts`: node `template` com o nome definido e sem `params`;
  `fillLegacyTemplateNames` troca, na cadência ainda em rascunho, só o `templateName` que continua
  igual ao marcador antigo (a edição do operador vence e o flow publicado não é tocado); o relatório
  traz `prefilledForApproval`.
- `agent_templates_arcada.run.ts`: imprime os pré-preenchidos que aguardam aprovação.
- `tools_agent_grants.ts`: sem mudança (a liberação `atendimento-humano` continua a mesma).

### O que cada nível inclui (fonte de cada item)

| Nível | Preço | Pagamento | Inclui | Fonte |
| --- | --- | --- | --- | --- |
| Essencial | R$ 297 | só à vista | 1 página longa + política + 404 | arcada.md + PLANO §1 |
| | | | até 6 tratamentos em blocos; responsável técnico em destaque (+1 colega); direção visual Arcada ajustada à marca; fotos do cliente com guia e tratamento; textos da biblioteca aprovados pelo dentista; até 6 avaliações do Google; medição sem cookie + cliques no WhatsApp; SEO local + Search Console; ficha do Google revisada; 2 rodadas de revisão; 30 dias de ajustes | PLANO §1 |
| Estúdio | R$ 397 | só à vista | 10 a 16 páginas; página por tratamento; corpo clínico com CRO de cada dentista | arcada.md + PLANO §1 |
| | | | até 8 tratamentos; design do zero; roteiro + sessão guiada por vídeo; textos por entrevista de 30 min; até 12 avaliações filtráveis; GA4 + Pixel + CAPI com consentimento; SEO por tratamento, sitemap, 3 artigos; plano de 4 semanas na ficha; 3 rodadas; 30 dias de ajustes + relatório | PLANO §1 |
| Cinema | R$ 999 | à vista ou 2 × R$ 499,50 | tudo do Estúdio + cena de scroll gerada, vídeo no topo e movimento dirigido | arcada.md (PLANO: "Estúdio + camada de movimento") |
| Todos | | | o nível muda o escopo, nunca a qualidade; verificação do Código de Ética Odontológica; site na estrutura da clínica, sem mensalidade obrigatória | arcada.md (O que é / Níveis / diferenciais) |

Para quem: a linha "Para quem" do `arcada.md`.

### Divergências entre as fontes (prevalece o `arcada.md`)

- Estúdio, "para quem": `arcada.md` "tratamentos de ticket alto" × PLANO "vários tratamentos de valor
  alto" → `arcada.md`.
- Cinema: `arcada.md` inclui "movimento dirigido", que o PLANO não cita → `arcada.md`.
- Cinema "teto de 1 por mês" (só no `arcada.md`) ficou **fora** do texto do agente: dito ao cliente,
  vira escassez. Agenda é assunto do Rogério, no handoff.
- PLANO §4 ainda diz "o Essencial precisa sair em 7 dias" (texto anterior a 29/09) → vale 5 dias úteis.
- PLANO §1 fala em "3 direções" no Essencial, mas §8 item 3 e §10 dizem que só a direção 1 existe. O
  texto diz "na direção escolhida", sem prometer 3.
- Recorrência (manutenção opcional R$ 290/mês, nas duas fontes) não é "o que o nível inclui": ficou
  fora, e `alteracoes_e_manutencao` continua marcador.

### Marcadores

Pré-preenchidos, aguardando aprovação: `nivel_essencial_inclui`, `nivel_estudio_inclui`,
`nivel_cinema_inclui`, `inicio_do_prazo`, `links_do_portfolio`, `modelo_lembrete_dia_3`,
`modelo_lembrete_dia_7`, `modelo_toque_30_dias`. Os 3 modelos (`arcada_lembrete_dia_3`,
`arcada_lembrete_dia_7`, `arcada_toque_30_dias`, `pt_BR`, sem parâmetros) **aguardam aprovação na
Meta**. O flow de cadência continua em rascunho.
Pendentes: `links_das_demos` (novo: a URL de cada demo não está nas fontes), `casos_autorizados`,
`como_agendar`, `meios_de_pagamento`, `material_necessario`, `dominio_e_hospedagem`,
`alteracoes_e_manutencao`, `google_e_seo`, `contrato_e_nota_fiscal`.

### Seed no dev (29/09, `localhost:5442`, banco `highermind`, workspace `dev`)

- Antes: v1 `live` (Sonnet 4, preço de 24/09), v2 `draft` (Sonnet 5, da F70-S31), agente inativo,
  KB v1 em rascunho, cadência em rascunho com `{{modelo_…}}`.
- 1ª rodada: `prompt_version:3:draft`, `kb:niveis:updated`, `kb:faq:updated`, `kb:portfolio:updated`,
  `flow:cadence:templates:3`. A versão nova é a **v3** e não a v2, porque a v2 já existia (rascunho da
  S31). O live (v1) e o prompt do agente ficaram intocados; o agente continua `inactive`; a KB (v2)
  continua `draft`, invisível; a cadência tem os 3 nomes novos e continua `draft`.
- 2ª rodada: "nada (idempotente)".

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db exec vitest run src/seed/agent_templates_arcada.test.ts src/seed/agent_templates_arcada.run.test.ts src/seed/tools_agent_grants.test.ts src/seed/llm_models.test.ts --maxWorkers=1
pnpm exec eslint packages/db/src/seed/agent_templates_arcada.ts packages/db/src/seed/agent_templates_arcada.content.ts packages/db/src/seed/agent_templates_arcada.run.ts packages/db/src/seed/agent_templates_arcada.test.ts packages/db/src/seed/tools_agent_grants.ts
```

## Definition of Done

- [x] testes: preços e nomes dos níveis; marcadores novos; parcelas por nível (Cinema 2 × R$ 499,50; os outros sem parcelamento); nenhuma oferta de desconto no texto gerado (prompt e KB)
- [x] seed no dev: rascunho novo (v3, porque a v2 da S31 já existia), live intocado, agente inativo, 2ª rodada sem criar nada
- [x] F70-S06 atualizado (decisões de 29/09)
