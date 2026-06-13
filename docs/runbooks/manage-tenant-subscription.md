# Runbook — Gerir Assinatura & Entitlements de um Tenant

> **Feature:** F26 — Platform Tenant Management · Pilar B.
> **Audiência:** super-admins de plataforma.
> **Status:** v1 — **gestão INTERNA** (`BILLING_ENABLED=false`): sem Stripe, sem cobrança
> real, sem webhooks de pagamento. Atribuição de plano/status/trial/override é manual.

A assinatura de um tenant é a combinação de: **plano** (do catálogo), **status**
(trial/active/past_due/canceled/expired), **trial** (data de término), **ciclo**
(mensal/anual) e, opcionalmente, um **override "custom plan"** que sobrepõe limites/features
do plano só para aquele tenant.

## Conceitos

- **Plano** (`/platform/plans`): bundle comercial com `limits` (ex. `max_agents`,
  `max_channels`, `max_monthly_messages`) e `features` (ex. `instagram`, `flows`,
  `api_access`) — chaves **tipadas** (o editor rejeita chave desconhecida).
- **Override** (`workspace_entitlement_overrides`): limites/features específicos que
  **vencem** o plano para um tenant. Ex.: dar +5 canais a um cliente sem criar plano novo.
- **Entitlements efetivos** = `plano` **merge** `override` (override vence). É o que
  `resolveEntitlements(workspaceId)` retorna — **fonte única** lida pela UI (e, futuramente,
  pelo enforcement do produto). Nunca hardcode limites em outro lugar.

## Catálogo de planos (`/platform/plans`)

- **Criar:** nova chave (slug único), nome, preços (centavos), limites e features tipados.
- **Editar:** preços/limites/features/posição. A chave é imutável após criação.
- **Desativar (soft-delete):** `is_active=false` — some do catálogo, mas **não** remove a
  linha (assinaturas existentes que referenciam o plano continuam válidas). Pede confirmação.

## Assinatura por tenant (`/platform/subscriptions`)

1. Selecione o tenant (ou venha do Workspace 360 → **Assinatura**, que já pré-seleciona).
2. **Trocar plano:** escolha outro plano ativo. A linha em `subscriptions` e o
   `workspaces.plan_id` são mantidos coerentes.
3. **Status:** transicione entre `trial → active → past_due → canceled/expired`. Mudanças
   para status destrutivo (canceled/expired/past_due) pedem confirmação (afetam o acesso).
4. **Trial:** edite `trialEndsAt` para estender o trial / conceder cortesia.
5. **Ciclo:** mensal ou anual.
6. **Override (custom plan):** preencha só os limites/features que quer sobrepor; deixe
   vazio para herdar do plano. O painel mostra os **entitlements efetivos** resolvidos,
   marcando com `*` o que veio de override.

## Efeito nos entitlements

- Salvar plano/override recomputa `resolveEntitlements` na hora; o painel reflete o merge.
- **Enforcement no produto** (bloquear criar canal/convidar membro acima do limite) é
  **follow-up incremental** — em v1 o painel define e resolve os entitlements, mas o
  produto ainda não os consome em todos os pontos. Não assuma bloqueio automático ainda.

## Pegadinhas

- **Override vence o plano sempre.** Se um tenant "tem mais do que o plano permite",
  provavelmente há um override — confira o painel de entitlements efetivos (marcas `*`).
- **Soft-delete não migra assinaturas.** Desativar um plano não move ninguém; reatribua os
  tenants antes se quiser aposentar um plano de fato.
- **Sem Stripe nesta fase.** Nenhuma ação aqui cobra o cliente. "active" é um estado
  administrativo interno, não um pagamento confirmado.
- **Toda mudança é auditada** (`audit_logs`, before/after). Use para rastrear "quem mudou o
  plano deste tenant e quando".
