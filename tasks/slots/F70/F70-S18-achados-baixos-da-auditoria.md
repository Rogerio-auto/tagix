---
id: F70-S18
title: Achados baixos da auditoria pré-deploy — marcadores de origem, referências restantes e guarda do seed
phase: F70
status: in-progress
priority: medium
estimated_size: S
depends_on: [F70-S11]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S11-referencias-cruzadas-entre-workspaces.md
agent_id: backend-engineer
claimed_at: 2026-09-25T05:57:17Z

---
# F70-S18 — Achados baixos da auditoria pré-deploy

> Auditoria de segurança de 25/09 sobre `origin/main..main` (fase F70). Os achados H1, M1 e L8 estão na F70-S15; M2, L3, L5, L6 e L7 ficam na F70-S19 (tocam arquivos em uso pela S15 e pela S16).

## Objetivo

Fechar os achados baixos que não colidem com slots em andamento.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/origin.ts`
- `packages/channels/src/meta/whatsapp/origin.test.ts`
- `packages/shared/src/conversation-origin*.ts`
- `packages/db/src/tenant-refs.ts`
- `packages/db/src/tenant-refs.test.ts`
- `apps/api/src/routes/campaigns/**`
- `apps/api/src/routes/org/**`
- `apps/api/src/routes/agents/**`
- `packages/db/src/seed/agent_templates_arcada.run.ts`

## Escopo (faz)

- **L1:** o marcador de site/IG casa só como prefixo da mensagem (depois de trim e normalização) e aceita um token não natural (ex.: `[ref:site-7f3a]`), documentado para o link `wa.me?text=`. O mínimo de 8 caracteres continua.
- **L4:** `requireRefsInWorkspace` em `campaigns/crud.ts` (`aiHandoffAgentId`), `org/org.ts` (`departmentId(s)`) e `agents/crud.ts:92`; `department` entra no `REF_TABLES`. Resposta igual para "não existe" e "é de outro workspace", como na S11.
- **L9:** a guarda do seed da Arcada exige `NODE_ENV !== 'production'` e confirma pelo nome do banco, além do hostname.

## Definition of Done

- [x] teste: marcador no meio da mensagem não classifica; no início, classifica; token funciona
  (`packages/channels/src/meta/whatsapp/origin.test.ts`, bloco "F70-S18 — marcador casa só como prefixo")
- [x] teste cross-tenant para cada rota de L4 (`apps/api/src/routes/{campaigns,org,agents}/cross-tenant.test.ts`)
- [x] teste: guarda do seed recusa `NODE_ENV=production` e banco com nome de produção
  (`packages/db/src/seed/agent_templates_arcada.run.test.ts`)

## Decisões

### L1 — marcador de origem só como prefixo

- `classifyConversationOrigin` casa o marcador só no **início** da primeira mensagem. Os dois
  lados passam por `normalizeOriginText`: NFKD, sem diacríticos, sem caracteres invisíveis
  (`\p{Cf}`: ZWSP, ZWJ, BOM, marcas de direção), minúsculas, espaços colapsados, trim. O NFKD
  também dobra formas de largura total (`［` vira `[`).
- **Fronteira no fim:** se o marcador termina em letra ou dígito, o próximo caractere da mensagem
  não pode ser letra ou dígito. Assim `vim pelo site` não casa `vim pelo sitezinho`.
- O mínimo de 8 caracteres (`MIN_PREFILL_MARKER_LENGTH`) continua, medido depois da normalização.
- Na dúvida, `sem-origem`: qualquer texto antes do marcador ("Olá! Vim pelo site...") agora
  classifica como `sem-origem`.

**Formato recomendado para o link do botão:** abrir o texto com um token não natural e, depois
dele, a frase para o humano.

| Onde | Valor |
| --- | --- |
| Marcador configurado | `[ref:site-7f3a]` |
| Link | `https://wa.me/5511999999999?text=%5Bref%3Asite-7f3a%5D%20Ol%C3%A1%2C%20vim%20pelo%20site` |
| Mensagem que chega | `[ref:site-7f3a] Olá, vim pelo site` |

- Forma: `[ref:<fonte>-<4 a 8 hex aleatórios>]`, um token por botão (site, bio do IG...).
- O sufixo aleatório impede reaproveitar o token de outro workspace e permite trocá-lo se vazar.
- O token precisa ser a **primeira** coisa do texto do link.
- A doc está em `OriginPrefillMarkers` (`@hm/channels`) e no JSDoc de
  `originPrefillMarkersFromSettings` (`@hm/shared`).

**Risco de migração:** um workspace que já tem `originPrefillMarkers` configurado e cujo link de
botão NÃO começa com o marcador (ex.: `Olá! Vim pelo site`, com o marcador `Vim pelo site`)
passa a classificar esses leads como `sem-origem`, e a IA deixa de atendê-los. Isso é
fail-closed (um humano atende), não um vazamento. No Postgres dev nenhum workspace real tem
marcadores (só fixtures de teste). **Antes do deploy, conferir no banco de produção:**

```sql
select slug, settings->'originPrefillMarkers' from workspaces where settings ? 'originPrefillMarkers';
```

Para cada linha, o texto do link `wa.me` precisa começar com o marcador. O ideal é trocar para
o token.

### L4 — referências restantes

- `department` entrou em `REF_TABLES` / `TenantRefKind` (`packages/db/src/tenant-refs.ts`).
- **Campanhas** (`campaigns/crud.ts`):
  - `POST` confere `channelId` e `aiHandoffAgentId`. O `channelId` não estava no achado, mas
    tem FK, e o builder abre conversa de teste pelo canal da campanha.
  - `PUT` confere `aiHandoffAgentId` depois de achar a campanha em rascunho. Campanha alheia
    continua 409 `not_editable`, respondido antes de olhar o payload.
- **Org** (`org/org.ts`):
  - `POST/PATCH /api/teams` conferem `departmentId`. No `PATCH`, o time alheio responde 404
    antes de olhar o payload.
  - `PUT /api/org/members/:id/visibility-overrides` confere `departmentIds`. Antes respondia
    `400 invalid_department`; agora responde o 422 canônico. Nenhum cliente web dependia do
    código antigo.
  - Os ids são deduplicados em minúsculas.
  - `PUT /api/sla` confere o `scopeId` pelo `scopeType` (department/team). A coluna não tem FK,
    mas uma regra apontando para o tenant alheio seria lixo e oráculo.
- **Agentes** (`agents/crud.ts`, `assertDepartmentsValid`): primeiro `requireRefsInWorkspace`
  (422 `invalid_reference`, `fields: ['departments']`), depois a checagem de ativo. Um
  departamento arquivado do próprio workspace continua 400, com mensagem própria, e não vaza
  nada de outro tenant.
- Em todas as rotas, a resposta para "é de outro workspace" é idêntica à de "não existe"; os
  testes comparam os dois corpos.
- Ficou de fora `agents.enabledChannelIds`: é array sem FK, a mesma regra da S11. Um id alheio
  nunca casa com o canal de um inbound do próprio workspace.

### L9 — guarda do seed da Arcada

- A função pura `assertSeedTargetAllowed(env)` está exportada. O `main` só roda como CLI, então
  importar o módulo no teste não semeia nada. As regras:
  1. `NODE_ENV=production` recusa **sempre**, sem escape.
  2. `DATABASE_URL` ausente, ilegível ou sem nome de banco também recusa.
  3. Banco local com nome que não é de produção roda direto.
  4. Nos outros casos, exige `ARCADA_SEED_ALLOW_REMOTE=1` **e**
     `ARCADA_SEED_CONFIRM_DATABASE=<nome exato do banco>`. Entram aqui o host remoto e o nome de
     produção, mesmo em `localhost`, que é o caso do túnel SSH.
- São nomes de produção: `leadium` (o `PG_DB` de `.env.production.example`) e qualquer nome com
  `prod`.
- O `[::1]` (forma do `URL.hostname` para IPv6) agora conta como local. Antes só `::1` contava,
  e esse valor nunca aparece.

### Fora do `files_allowed`

- Arquivos novos:
  - `packages/db/src/seed/agent_templates_arcada.run.test.ts`, teste exigido pelo DoD, ao lado
    do `.run.ts`;
  - `tasks/COMMS.md`, com um pedido ao dono de `apps/workers/src/inbound/**`.
- `apps/workers/src/inbound/origin-gate.test.ts:442` usa o marcador no meio da mensagem e espera
  `origem:site`. O teste está em skip no dev. O pedido de ajuste está no COMMS; não mexi, porque
  o arquivo é da S16.

## Validação

```bash
pnpm --filter @hm/channels exec vitest run src/meta/whatsapp/origin.test.ts --maxWorkers=2
pnpm --filter @hm/shared exec vitest run src/conversation-origin.test.ts --maxWorkers=2
pnpm --filter @hm/db exec vitest run src/tenant-refs.test.ts src/seed/agent_templates_arcada.run.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/org src/routes/campaigns/cross-tenant.test.ts src/routes/campaigns/routes.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/agents/cross-tenant.test.ts src/routes/agents/crud.test.ts src/routes/agents/routes.test.ts --maxWorkers=2
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
```
