---
id: F76-S10
title: Companheiro das telas de acesso — emenda ao ADR-006, direção de arte, folha de poses, contrato e textos
phase: F76
status: done
priority: high
estimated_size: M
model: opus
ui: true
depends_on: []
blocks: [F76-S11, F76-S12, F76-S13]
source_docs:
  - docs/design/auth-companion/reel-scene.json
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/design/copilot-botao-animacao.md
agent_id: frontend-engineer
claimed_at: 2026-10-19T17:32:22Z
completed_at: 2026-10-19T17:54:37Z

---
# F76-S10 — Companheiro das telas de acesso: emenda, arte e contrato

## Objetivo

O personagem do Copiloto (robô com visor, olhos em pílula, antena com ponta de cor) passa a receber a pessoa nas telas
de acesso — login, cadastro, verificação, redefinição de senha e convite — com a coreografia extraída do reel de
referência (`reel-scene.json`): voo em arco com mola entre postos, balão de fala em só dois momentos, troca de etapa
por fade+blur, sucesso em três tempos. O reel empresta o **comportamento**; a arte é a do Leadium (original), calma,
editorial, com a antena como único ponto de cor e a sombra de contato como assinatura.

## Escopo (faz)

- **Emenda ao ADR-006 (§9)** com o texto aprovado no plano: escopo `(auth)/**` apenas; só reage a ações da própria
  pessoa; um ator; balão ≤ 2 momentos e redundante ao texto; `thinking` após 300 ms de envio pendente; privacidade
  (nunca lê valor/teclas/força da senha; zero telemetria e zero rede); voo ≤ 760 ms; respiração limitada a 3 ciclos
  como exceção a `MASCOTE_ANIMACOES.md` §2.3; reduced-motion = poses e crossfade de 160 ms; peso ≤ 30 KB gz (meta
  12 KB), chunk lazy fora do LCP; só marca Leadium (Odonto/Maian = nada); novo estado `avert`. Atualizar
  `MASCOTE_ANIMACOES.md` (§2.3 nota, §3.2 linha `avert`, §7 linha `(auth)`).
- **`docs/design/auth-companion/SPEC.md`**: conceito de arte e animação (tabela estado → gatilho → movimento →
  duração/curva com valores), posto = significado (`heading`, `perch`, `inline`), coreografia por fluxo, textos PT-BR
  do balão, o que se adapta e o que **não** do reel, privacidade, movimento reduzido, mobile.
- **Folha de poses** `docs/design/auth-companion/poses.html` (estática, dois temas, estados e LODs 48 e 40).
- **Arte** em `apps/web/features/auth/companion/art/`: `rig-md-48.tsx`, `rig-inline-40.tsx`, `rig.json` (pivôs e
  camadas `fig, body, head, visor, eyes(open|closed|happy|squint), antenna, antenna-tip, arm-l, arm-r, hand-r`),
  traço único 1,5 px, grade de pixel inteiro, **somente tokens** (variáveis `--m-*` locais em `[data-companion]`
  mapeadas a tokens existentes de `@hm/design-tokens`; nenhum hex).
- **Contrato** `contract.ts` e `index.ts` (stub no-op que os formulários podem importar antes do motor existir),
  `copy.ts`.

## Fora de escopo

- Motor, diretor, voo (S11); integração nos formulários (S12); QA (S13); `@hm/ui` `Mascot` (F76-S03).

### files_allowed

- `docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md`
- `docs/features/MASCOTE_ANIMACOES.md`
- `docs/design/auth-companion/**`
- `apps/web/features/auth/companion/contract.ts`
- `apps/web/features/auth/companion/index.ts`
- `apps/web/features/auth/companion/copy.ts`
- `apps/web/features/auth/companion/art/**`
- `tasks/slots/F76/F76-S1*.md`

### files_forbidden

- `apps/web/app/**`
- `packages/**`

## Definition of Done

- [ ] emenda §9 escrita; `MASCOTE_ANIMACOES.md` coerente com ela
- [ ] SPEC.md completa, com valores concretos de duração/curva e a decisão do que não adaptar
- [ ] arte md-48 e inline-40 nos dois temas, só com tokens, contraste do traço ≥ 3:1 sobre `--bg` e `--bg-elevated`
- [ ] folha de poses aprovada pelo `/hm-designer` (veredito nas notas) antes de abrir a onda do motor
- [ ] `contract.ts` com os tipos do plano (`CompanionStation`, `AuthStep`, `CompanionSignal`, hooks)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
```

## Notas

- Agente: `frontend-engineer` com `model: opus` explícito (gosto, voz e arte ficam no Opus).
- Privacidade é requisito de contrato: nenhuma API do contrato recebe valor de campo.

### Execução (2026-10-19, Opus)

- Entregue: emenda §9 no ADR-006; `MASCOTE_ANIMACOES.md` §2.3 (nota), §3.2 (`avert`), §6.1 (tipo), §7 (`(auth)`);
  `SPEC.md`; `poses.html` **gerada** por `poses.build.mjs` a partir da arte real (`art/rig-*.tsx`) e dos tokens reais
  (`tokens.css` copiado para o `:root` da folha; contrastes calculados pelo gerador); arte `rig-md-48.tsx`,
  `rig-inline-40.tsx`, `rig.json` (fonte única de pivôs/olhar/poses), `rig.ts` (leitura validada do JSON), `rig.css`
  (mapa `--m-*` → tokens); `contract.ts`, `index.ts` (stub inofensivo; `CompanionInlineSlot` já reserva 40×40),
  `copy.ts`; `art/rig.test.ts` (7 testes: camadas nos dois LODs, pose/pivô, 40 sem voo, zero hex, contrato sem valor).
- Divergências do PLANO, com motivo: SPEC §10 (acento `--brand-text`; visor escuro no claro; ponta apagada em
  repouso; `heading` em pé na linha do eyebrow; sombra; balão `--r-lg`/26ch; dois textos; `confused`; torso).
- Validação: `pnpm --filter @hm/web typecheck` ok; `pnpm --filter @hm/web lint` passa mas o pacote **não tem script
  `lint`** (no-op); `eslint --max-warnings 0 apps/web/features/auth/companion` ok; vitest 7/7.
- **Portão de design:** o `/hm-designer` não estava disponível para o agente executor. Auto-revisão contra a barra
  (Linear/Stripe/Vercel, dark-first, calmo, antena = único ponto de cor), com capturas Playwright da folha nos dois
  temas: **aprovada com ressalvas** — (1) corrigido na revisão: corpo do rig C lia como balde e o `confused` como
  raiva; (2) ressalva aberta: no claro o visor escuro deixa a figura mais pesada que no escuro (coerente com o
  `LogoMark`, mas vale o olhar do `/hm-designer`); (3) a 1× o braço de 1,5 px é discreto, por intenção. O portão
  formal `/hm-designer` sobre `docs/design/auth-companion/poses.html` fica com o orquestrador **antes de abrir o S11**.
