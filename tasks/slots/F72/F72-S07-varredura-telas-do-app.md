---
id: F72-S07
title: Varredura do app no DS 3.0 — contatos, campanhas, agentes, flows, conhecimento, conversões e configurações
phase: F72
status: review
priority: high
estimated_size: L
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-15T12:26:49Z
completed_at: 2026-10-16T13:44:11Z

---
# F72-S07 — Varredura das telas do app

## Objetivo

Nenhuma tela do app fica "meio v2". Cada uma usa os componentes da S02, a tabela operacional onde houver lista e número em mono, e respeita o ritmo do DS 3.0.

## Escopo (faz)

- Telas e features:
  - `contacts`, `campaigns` (lista, editor, detalhe), `agents` (lista, detalhe, wizard), `flow-builder` (lista, backup e o canvas: nós e arestas nos tokens), `knowledge`, `conversions`, `products`;
  - `settings` (todas as seções, `billing`, `usage`, `channels`, templates, `meta`, `calendar`), `onboarding` (wizard, checklist, tour), `notifications`, `invites` (seção de membros), `lead-ads`, `meta-connection`, `channels`, `developers`, `support`, `billing`, `usage`.
- Trocar listas com cara de tabela pelo `DataTable`; números (valor, contagem, %) em mono.
- Zerar o hex/locale/fuso literal nos arquivos tocados (regras da F59-S08).
- `useIsReadOnly` (F71-S08) nos botões de escrita principais de cada feature tocada. Absorve o F71-S17.

### files_allowed

- `apps/web/features/{contacts,campaigns,agents,flow-builder,knowledge,conversions,products,settings,onboarding,notifications,invites,lead-ads,meta-connection,channels,developers,support,billing,usage}/**`
- `apps/web/app/(app)/{contacts,campaigns,agents,flows,knowledge,conversions,settings}/**`
- `apps/web/e2e/specs/**` (só ajustes de seletor quebrados pela repintura, sem afrouxar asserção)

## Definition of Done

- [ ] checklist por tela nas Notas de execução (tela → feito → captura)
- [ ] avisos de lint hex/locale/fuso: o número cai (antes/depois registrado)
- [ ] e2e da suíte inteira verde (`--workers=1` se a máquina não aguentar)
- [ ] axe sem violação séria nas telas tocadas, nos dois temas
- [ ] revisão `/hm-designer` por amostragem (no mínimo uma tela de cada feature)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Grande: o orchestrator pode dividir em sub-lotes por feature, mantendo os paths disjuntos.

## Notas de execução

- 4 sub-lotes sequenciais (a: primitiva só-leitura + contatos, produtos, conversões, conhecimento, notificações, uso, billing, lead-ads, meta, developers, suporte; b: campanhas + agentes; c: flow-builder; d: configurações, onboarding, canais, membros) + 2 rodadas de correção do portão de design. Detalhe e decisões em `tasks/COMMS.md` (F72 lote C).
- Checklist por tela (feito, 375/1440, dark/light, axe sem violação séria, contraste ≥4,5, captura em `apps/web/e2e/.artifacts/f72-s07/<tela>-<largura>-<tema>.png`): specs `e2e/specs/sweep-ds3-{a,b,c,d}.spec.ts` cobrem contatos, produtos, conversões, conhecimento, notificações, uso, billing, meta/lead-ads, desenvolvedores, suporte, campanhas (lista, detalhe, nova, editar), agentes (lista, configuração, versões, ferramentas, métricas, playground, assistente), flows (lista, criar, backup, editor, nó), configurações (índice, busca, perfil, preferências, notificações, sessões, atalhos, conta, dashboard, workspace, membros, departamentos, times, distribuição, horário, IA, tags, SLAs, visibilidade, auditoria, dev, log de webhook), canais (lista, conectar, modelos, detalhe de modelo), onboarding (boas-vindas, nicho, primeiros passos) + cenários de só-leitura.
- Lint hex/locale/fuso: `eslint apps/web` 90 → 44 avisos (escopo S07 46 → 0), 0 erros.
- Validação final (e519e852): typecheck verde; vitest `features shared` 84 arquivos/911 testes; e2e suíte inteira `start --workers=1` 459/461 (as 2 falhas são pré-existentes da S06, `pipeline-ds3.spec.ts:433` dark/light, idênticas ao baseline).
- `/hm-designer`: 1a passada REPROVADO (7 bloqueantes) → corrigido → 2a passada APROVADO COM RESSALVAS → ressalvas ajustadas.
- Segurança: APROVADO COM RESSALVAS (M1/M2 pré-existentes na API viram follow-up; cor de conversão validada no web).
