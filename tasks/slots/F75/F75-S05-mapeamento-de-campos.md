---
id: F75-S05
title: Motor de mapeamento de campos e proposta assistida com confiança por campo
phase: F75
status: blocked
priority: high
estimated_size: M
model: opus
depends_on: [F75-S01, F75-S02, F75-S07, F75-S14]
blocks: [F75-S04, F75-S06, F75-S10, F75-S12]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
agent_id: backend-engineer
---
# F75-S05 — Mapeamento de campos

## Objetivo

Os campos do sistema externo caem nos lugares certos do Leadium por um mapeamento versionado, puro e sem
`eval`; e no passo 3 do assistente a pessoa cola um exemplo e recebe a proposta de mapeamento com a confiança de
cada campo, com o que fica abaixo de 80% marcado para revisar e o obrigatório sem destino bloqueando o Continuar.

## Contexto

Spec §4.3, maquete B3 passo 3 (tabela "Campo no Nimbo → Campo no Leadium → Confiança", sub-mapa
`Faturado → Ganho`). A parte de LLM roda no agent-runtime (S14, contrato fixo abaixo).

## Escopo (faz)

- `packages/shared/src/integrations/mapping.ts`: `FieldMappingSchema` = lista de `{ source: path, target:
  TargetKey | 'ignore', transforms: Transform[], required: boolean }` por entidade; caminho restrito (`a.b`,
  `a[]`, `a[0].b`, máx. 8 níveis); transforms fechados: `trim`, `lower`, `digits_only`,
  `phone_e164 { defaultDdd? }`, `cpf_cnpj`, `money { decimal: '.'|',' }`, `date { format, tz }`,
  `enum_map { map: Record<string,string>, fallback? }`, `default { value }`, `concat { sep, with: path[] }`.
- `packages/integrations/src/mapping/`:
  - `resolvePath(obj, path)` sem `eval`, sem protótipo (`__proto__`, `constructor`, `prototype` recusados);
  - `applyMapping(raw, mapping) → { record: CanonicalRecord, issues: Issue[] }` puro, determinístico, com teste
    de propriedade (mesma entrada ⇒ mesma saída);
  - `heuristics.ts`: detecção de tipo por valor (CPF/CNPJ com dígito verificador, telefone BR, e-mail, dinheiro,
    data ISO/BR, booleano, enum curto) + similaridade de nome (`fone_cel` ~ `phone`, `cpf_cnpj` ~ `document`) ⇒
    proposta determinística com confiança;
  - `mask.ts`: mascara valores antes de saírem do processo (`"(11) 9****-**55"`, `"maria.s***@email.com"`,
    `"123.***.***-09"`, números mantêm a forma) — **nada cru vai ao LLM**;
  - `combine.ts`: confiança final = máximo quando LLM e heurística concordam no destino, `min` quando divergem
    (e o destino é o do maior), `needsReview = confidence < 0.80`; obrigatório sem destino ⇒ `blocker`.
- `packages/agents-client/src/mapping.ts` (+ export no `index.ts`): `proposeMapping(req)` para
  `POST /internal/mapping/propose` do agent-runtime, com o mesmo token interno e timeout de 15 s; resposta
  validada por Zod.
- API:
  - `apps/api/src/services/integrations/mapping.ts`: `propose({ connectionId, entity, sample? })` — achata o
    exemplo (≤ 32 KB, profundidade ≤ 10, ≤ 200 campos), roda a heurística, pede ao S14 só caminhos + tipos +
    valores mascarados + lista fechada de destinos, combina; se o agent-runtime falhar ou demorar, devolve só a
    heurística com `source: 'heuristic'` (o assistente continua funcionando); **o exemplo não é persistido nem
    logado**;
  - `apps/api/src/routes/integrations/mapping.ts` (criado vazio pelo S07):
    `POST /api/integrations/connections/:id/mapping/propose` e `PUT /api/integrations/connections/:id/mapping/
    :entity` (nova versão ativa, audita `mapping.changed`), ambos `integration.manage`, rate limit de proposta
    20/h por conexão.

## Contrato com o S14 (fixo)

```ts
// POST /internal/mapping/propose  (Authorization: Bearer <AGENT_RUNTIME_INTERNAL_TOKEN>)
req = { workspaceId: uuid, connectorId: string, entity: string,
        fields: Array<{ path: string; detectedType: string; maskedExample: string }>,   // ≤ 200
        targets: Array<{ key: string; label: string; type: string; required: boolean }> }
res = { proposals: Array<{ path: string; target: string /* key de targets ou 'ignore' */;
                           confidence: number /* 0..1 */; rationale: string /* PT-BR, ≤ 140 */ }>,
        model: string, usage: { promptTokens: number; completionTokens: number; costUsd: number } }
```

## Fora de escopo

- O endpoint Python (S14). A UI do passo 3 (S10). Aplicar o mapeamento na sincronização (S04 consome
  `applyMapping`).

### files_allowed

- `packages/shared/src/integrations/mapping.ts`
- `packages/integrations/src/mapping/**`
- `packages/agents-client/src/mapping.ts`
- `packages/agents-client/src/mapping.test.ts`
- `packages/agents-client/src/index.ts`
- `apps/api/src/services/integrations/mapping.ts`
- `apps/api/src/services/integrations/mapping.test.ts`
- `apps/api/src/routes/integrations/mapping.ts`

## Definition of Done

- [ ] teste: exemplo da maquete (pedido Nimbo) ⇒ `cliente.nome → Contato › Nome` ≥ 0,95,
      `pedido.situacao → Negócio › Estágio` com `enum_map` e `needsReview`, `cliente.obs → ignore`
- [ ] teste: `__proto__`/`constructor` no caminho são recusados; nenhum `eval`/`Function`
- [ ] teste: o corpo enviado ao agent-runtime não contém nenhum valor cru do exemplo (grep do JSON enviado)
- [ ] teste: agent-runtime fora ⇒ proposta heurística, 200, `source: 'heuristic'`
- [ ] teste: obrigatório sem destino ⇒ `blockers` com o nome do campo
- [ ] teste: `phone_e164 { defaultDdd: '11' }` completa `98123-4455` ⇒ `+5511981234455`; `(9) 8123-4455`
      (DDD inválido) vira issue `invalid_phone_no_ddd`, nunca um número inventado
- [ ] exemplo não aparece em log nem em banco (grep)

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/integrations typecheck
pnpm --filter @hm/agents-client typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/integrations exec vitest run src/mapping --maxWorkers=1
pnpm --filter @hm/agents-client exec vitest run --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations/mapping.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Destinos canônicos vêm de `packages/shared/src/integrations/targets.ts` (S02).
- `packages/agents-client/src/index.ts` pode ser tocado pela F74 (cliente do Copiloto): uma linha de export.
