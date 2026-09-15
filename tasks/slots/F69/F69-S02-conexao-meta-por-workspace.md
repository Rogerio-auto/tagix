---
id: F69-S02
title: Conexão Meta por workspace — permissões dos casos de uso, token cifrado e reconexão guiada
phase: F69
status: available
priority: critical
estimated_size: L
depends_on: [F69-S01]
blocks: [F69-S03, F69-S04, F69-S08]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer

---
# F69-S02 — Conexão Meta por workspace — permissões dos casos de uso, token cifrado e reconexão guiada

## Objetivo

Um jeito só de o cliente conectar a Meta ao Leadium, pedindo as permissões dos casos de uso que ele vai usar, guardando o que foi concedido e dizendo com clareza quando falta alguma.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §5.6. Hoje cada canal tem o próprio login: o WhatsApp usa Embedded Signup com `config_id`, o Instagram usa `FB.login` com escopo fixo em `fb-login.ts`. Não existe registro de quais permissões o usuário concedeu, então uma permissão negada só aparece como erro no meio de uma ação. Com 50 clientes (decisão de 2026-09-14), a conexão precisa ser autosserviço.

## Escopo

### files_allowed

- `packages/db/src/schema/meta_connections.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/meta-connections.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/**`
- `packages/db/src/*.test.ts`
- `apps/api/src/services/meta/**`
- `apps/api/src/routes/meta/**`
- `apps/api/src/app.ts`
- `apps/web/features/meta-connection/**`
- `apps/web/features/channels/fb-login.ts`
- `apps/web/app/(app)/settings/meta/**`

### files_forbidden

- `apps/workers/src/outbound/**`
- `packages/shared/src/consent.ts`

## Escopo (faz)

- `meta_connections` (workspace, usuário Meta, Business, token de longa duração cifrado, expiração, **permissões concedidas e negadas**, ativos vinculados: páginas, contas de anúncio, contas IG, WABAs) com RLS.
- Troca de código por token no servidor; token nunca vai ao navegador.
- Leitura de `/me/permissions` após conectar e antes de cada operação sensível.
- Tela de conexão por caso de uso: o cliente escolhe o que quer ligar (leads, anúncios, Instagram) e vê o que cada um pede.
- Estado de saúde: token perto de expirar, permissão revogada, ativo removido — com botão de reconectar pedindo só o que falta.

## Fora de escopo

- Usar a conexão para leads, anúncios ou publicação (S03, S04, S07).
- Migrar o Embedded Signup do WhatsApp, que funciona e está em produção.

## Definition of Done

- [ ] Token de longa duração cifrado em repouso; teste confirma que nenhuma rota devolve o token.
- [ ] Permissões concedidas e negadas persistidas e atualizadas ao reconectar.
- [ ] Ação que exige permissão ausente responde com qual falta e como resolver, em vez de erro genérico.
- [ ] RLS: workspace A não lê a conexão de B; teste cobre.
- [ ] Reconexão pede apenas as permissões que faltam.
- [ ] Desautorização (F69-S01) marca a conexão como desconectada.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono conecta sozinho, e quando algo quebra a tela diz exatamente o quê.
