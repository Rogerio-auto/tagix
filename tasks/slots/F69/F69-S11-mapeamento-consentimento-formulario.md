---
id: F69-S11
title: Consentimento do formulário de anúncio — caixa marcada vira consentimento de canal
phase: F69
status: available
priority: high
estimated_size: M
depends_on: [F69-S03]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer

---
# F69-S11 — Consentimento do formulário de anúncio — caixa marcada vira consentimento de canal

## Objetivo

O cliente diz, uma vez por formulário, qual caixa de consentimento autoriza qual canal e finalidade; a partir daí, todo lead com a caixa marcada entra com consentimento registrado em `contact_consents`, com o texto exato que a pessoa leu como prova.

## Contexto

Nasceu da F69-S03 (decisões de 2026-09-15). A S03 já guarda, junto de cada lead, o termo do formulário e o texto de cada caixa (`lead_ad_submissions.consent_responses`). O que falta é a **concessão**: o texto da caixa é livre, escrito pelo cliente, e deduzir dele que "Aceito receber novidades" autoriza WhatsApp de marketing seria afirmar um consentimento que ninguém deu. Nos EUA (Flórida é o primeiro mercado), formulário de anúncio é a origem de consentimento mais comum e a mais contestada — SMS e WhatsApp de marketing sem consentimento registrado são o risco jurídico mais caro do produto.

## Escopo

### files_allowed

- `packages/db/src/schema/lead_ads.ts`
- `packages/db/src/repos/lead-ads.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/**`
- `apps/workers/src/leadgen/**`
- `apps/api/src/routes/meta/lead-sources.ts`
- `apps/api/src/routes/meta/lead-sources.test.ts`
- `apps/web/features/lead-ads/**`

### files_forbidden

- `packages/shared/src/consent.ts`
- `apps/workers/src/outbound/**`

## Escopo (faz)

- Listar os formulários de cada página ativa e as caixas de cada um (`legal_content.custom_disclaimer.checkboxes`).
- Tela: para cada caixa, escolher canal (`meta_whatsapp`, `sms`, `email`…) e finalidade (`transactional` | `marketing`), ou "não concede".
- Worker: lead com caixa marcada e mapeada → `consentRepo.grant` com `proof` = texto exato da caixa + termo + formulário + data do envio + `leadgen_id`; `source` = `meta_lead_form`.
- Retroativo opcional: aplicar o mapeamento aos leads já recebidos daquele formulário, usando a prova já copiada na S03 (nunca o texto atual do formulário, que pode ter mudado).
- Caixa desmarcada não revoga nada — só não concede.

## Fora de escopo

- Consentimento fora de formulário de anúncio (F59).
- Regras de envio por mercado (portão da F59-S04 já decide).

## Definition of Done

- [ ] Caixa mapeada e marcada gera consentimento com o texto exato exibido como prova.
- [ ] Caixa sem mapeamento não gera consentimento.
- [ ] Mudança posterior no texto do formulário não altera a prova de leads antigos.
- [ ] Aplicação retroativa usa a prova copiada no lead, não o formulário atual.
- [ ] RLS e isolamento por workspace testados.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- Validar com advogado o texto-modelo de caixa que o cliente deve usar para SMS/WhatsApp de marketing nos EUA (TCPA) antes de recomendar na tela.
