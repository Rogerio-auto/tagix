---
id: F76-S08
title: Marca por empresa com flag do personagem (Odonto só glifo, Maian) e telemetria só de evento
phase: F76
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F76-S04, F76-S05]
blocks: [F76-S09]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
agent_id: frontend-engineer
---
# F76-S08 — Marcas, flag e telemetria

## Objetivo

Cada empresa tem tema de marca e decisão de personagem definidos pela plataforma: o Leadium Odonto nunca mostra
rosto, robô ou faísca (só o glifo parado com varredura por evento), a Maian usa o tema claro laranja com contraste
correto e personagem ou glifo conforme a decisão do Rogério, e a eficácia do orçamento de atenção é medida só por
eventos, sem conteúdo.

## Contexto

Spec §5. Hoje não existe mecanismo de marca por empresa (só `--brand` e `settings.brand_color`). Os tokens por
`[data-brand]` já vêm do S03; aqui é o encanamento, a regra e a telemetria.

## Escopo (faz)

- `packages/shared/src/mascot/brand.ts`: Zod `WorkspaceBrandSchema = { theme: 'leadium'|'odonto'|'maian', mascot:
  'character'|'glyph' }` com refine "`odonto` ⇒ `glyph`"; `resolveBrand(settings)` com padrão
  `{ theme: 'leadium', mascot: 'character' }`.
- API:
  - `apps/api/src/routes/platform/brand.ts` + uma linha em `apps/api/src/routes/platform/index.ts`:
    `GET/PUT /api/platform/tenants/:id/brand` (`requirePlatformAdmin`), grava em `workspaces.settings.brand` com
    merge (não toca `brand_color`), auditoria `workspace.brand_changed`;
  - `apps/api/src/auth/routes.ts`: `mePayload` passa a incluir `workspace.brand` resolvido (só esse campo);
  - `apps/api/src/routes/members/ui-events.ts` + uma linha em `apps/api/src/routes/members/index.ts`:
    `POST /api/members/me/ui-events` com o lote da spec §5 (Zod estrito, só `copilot_nudge`, ≤ 20 por lote, 30
    req/min por membro) ⇒ `HINCRBY` em `ui:nudge:<AAAA-MM-DD>:<workspaceId>` campo `<kind>:<outcome>:<motion>`,
    TTL 120 dias, e log estruturado sem PII; resposta `204`.
- Web:
  - `<html data-brand>` aplicado sem flash: o script anti-flash de tema em `apps/web/app/layout.tsx` também lê a
    marca de um cookie `hm_brand` (definido na resposta do `/api/me` pelo cliente; valor validado contra a lista)
    e o `providers.tsx` sincroniza ao trocar de empresa;
  - `MascotStage` do shell recebe `brandVariant` da marca (`glyph` ⇒ todo personagem vira glifo parado, inclusive
    `LongWait`, vazios e intro);
  - `apps/web/features/copilot/attention/telemetry.ts`: o diretor (S04) envia `copilot_nudge` com o desfecho
    (`opened_60s` | `ignored` | `suppressed`) em lote por `sendBeacon` a cada 60 s ou `pagehide`;
  - Plataforma: seletor de marca e personagem em `apps/web/features/platform-admin/tenants/BrandSettings.tsx`
    (montado na página do tenant), com prévia do botão do Copiloto nas três marcas.
- Testes: `odonto` + `character` ⇒ 400; `/api/me` traz a marca; e2e com marca Odonto — nenhum SVG de personagem
  no DOM em launcher, loading, vazio e intro (só glifo); Maian claro — contraste do "Copiloto" ≥ 4,5:1 medido no
  navegador; telemetria não aceita evento fora da lista e não grava nada além dos contadores.

## Fora de escopo

- Painel de leitura da telemetria. Branding visual além do personagem e da varredura (logo, cores de marca do app).

### files_allowed

- `packages/shared/src/mascot/brand.ts`
- `packages/shared/src/mascot/brand.test.ts`
- `apps/api/src/routes/platform/brand.ts`
- `apps/api/src/routes/platform/brand.test.ts`
- `apps/api/src/routes/platform/index.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/routes/members/ui-events.ts`
- `apps/api/src/routes/members/ui-events.test.ts`
- `apps/api/src/routes/members/index.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/providers.tsx`
- `apps/web/features/copilot/attention/telemetry.ts`
- `apps/web/features/copilot/attention/telemetry.test.ts`
- `apps/web/features/platform-admin/tenants/BrandSettings.tsx`
- `apps/web/features/platform-admin/tenants/BrandSettings.test.tsx`
- `apps/web/e2e/specs/brand-mascot.spec.ts`

## Definition of Done

- [ ] regra Odonto ⇒ glifo garantida no servidor e no cliente (testes nos dois lados + e2e)
- [ ] sem flash de marca no primeiro paint (captura do primeiro frame com cookie de Odonto e Maian)
- [ ] `/api/me` com `workspace.brand`; trocar de empresa troca a marca sem recarregar
- [ ] telemetria só com eventos da lista, sem texto/rota/conteúdo; contadores conferidos no Redis do dev
- [ ] capturas do launcher nas três marcas × dois temas em `apps/web/e2e/.artifacts/f76-s08/`; axe ok
- [ ] `security-auditor` revisa a rota de plataforma e a de telemetria (rate limit, validação)

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
pnpm --filter @hm/shared exec vitest run src/mascot --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/platform/brand.test.ts src/routes/members/ui-events.test.ts --maxWorkers=1
pnpm --filter @hm/web exec vitest run features/copilot/attention features/platform-admin/tenants --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer` (as rotas são pequenas e seguem o padrão existente). `auth/routes.ts`,
  `layout.tsx` e `providers.tsx` são arquivos de alto tráfego: mudança mínima, uma responsabilidade.
- Maian: até o Rogério decidir, cadastrar com `mascot: 'glyph'`.
