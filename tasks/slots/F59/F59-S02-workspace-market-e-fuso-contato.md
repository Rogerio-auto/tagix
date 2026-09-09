---
id: F59-S02
title: Mercado no workspace e fuso no contato
phase: F59
status: in-progress
priority: critical
estimated_size: S
depends_on: [F59-S01]
blocks: [F59-S03, F59-S07]
source_docs:
  - docs/features/AGENCIA_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T05:28:52Z

---
# F59-S02 — Mercado no workspace e fuso no contato

## Objetivo

Dar ao schema as duas colunas que hoje impedem operar nos EUA: `workspaces.market` (+ locales) e
`contacts.timezone`. Hoje o fuso vive na campanha com padrão `America/Sao_Paulo`, o que quebra com
clientes na Flórida e na Califórnia na mesma base.

## Contexto

`AGENCIA_PLAN` §3.2 e §4.1: nos EUA a janela horária é no fuso do **destinatário**, não da campanha.
Desbloqueia F59-S03 (consentimento por mercado) e F59-S07 (valores personalizados).

## Escopo

### files_allowed

- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/contacts.ts`
- `packages/db/drizzle/0069_f59_market_and_contact_timezone.sql`
- `packages/db/drizzle/meta/**`
- `packages/db/src/**/*.test.ts`

### files_forbidden

- `apps/**`
- `packages/shared/**`

## Escopo (faz)

- `workspaces.market` `text not null default 'BR'` com `check (market in ('BR','US'))`.
- `workspaces.locales` `jsonb not null default '["pt-BR"]'`, tipado como `string[]`.
- `contacts.timezone` `text null` — nulo significa "usar o `defaultTimezone` do market pack".
- Índice `idx_contacts_workspace_timezone` parcial (`where timezone is not null`), que é o que o
  agendador vai varrer para agrupar por janela.

## Fora de escopo

- Consumir as colunas (F59-S04/S05).
- Migrar `contacts.marketing_opt_in` (F59-S03 — é migração de dado, não de coluna).
- Forma de endereço US em `contacts.address` (fica para o slot de cadastro; hoje o jsonb aceita, e
  forçar a forma agora quebraria o cadastro BR sem ganho imediato).

## Definition of Done

- [ ] Migration `0069` aplica e reverte sem perda; `pnpm --filter @hm/db migrate` verde em base limpa e em base com dado.
- [ ] `check` de `market` rejeita valor fora de `BR|US` (teste de integração).
- [ ] `workspaces` e `contacts` já têm RLS; confirmar por teste que as colunas novas não abrem leitura cross-workspace.
- [ ] Default `BR` preserva o comportamento de todos os workspaces existentes — nenhuma mudança observável para quem já usa.
- [ ] `contacts.timezone` aceita apenas IANA válido na camada Zod (não no banco); documentar a escolha.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/db lint
```

## Notas

- **Não** validar fuso com `check` no Postgres: a lista IANA muda e um check engessa a migration.
  Validação fica em Zod, na borda.
- `locales` como jsonb e não como coluna de array PG: o resto do schema já usa jsonb para lista
  simples (`plans.features`), e a consulta por locale não existe.

## Decisões tomadas na execução (2026-09-09)

1. **`locales` é NULO por default, não `'["pt-BR"]'`.** A spec original pedia `not null default
   '["pt-BR"]'`. Ao ler o schema descobri que `workspaces` **já tem** `locale` (singular, default
   `pt-BR`) e `timezone`. Um `locales` obrigatório duplicaria o market pack e derivaria dele com o
   tempo: workspace US nasceria com `["pt-BR"]` enquanto o pack diz `["en-US","pt-BR"]`, e alguém
   leria o valor errado. Nulo significa **"usar os locales do market pack"**; a coluna só é
   preenchida quando o cliente restringe (empresa nos EUA que atende só em inglês). `workspaces.locale`
   segue sendo o idioma padrão da interface — são eixos diferentes e ambos continuam válidos.
2. **Nenhuma coluna de endereço US.** `contacts.address` é jsonb com forma brasileira (`cep`,
   `bairro`). Forçar a forma americana agora quebraria o cadastro BR sem ganho imediato — entra no
   slot de cadastro, quando houver tela que a consuma.
3. **`market` tipado como `'BR' | 'US'` via `$type<>()`** em vez de enum PG: o CHECK dá a garantia no
   banco e o `$type` dá a garantia no TypeScript, sem o custo de migration de enum quando um terceiro
   mercado entrar.
