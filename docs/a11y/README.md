# Acessibilidade — Highermind v2

> **Escopo deste relatório:** auditoria F10-S05 (contraste AAA dos tokens de texto,
> navegação por teclado e ARIA nos primitives `@hm/ui` + camada `apps/web/shared`).
> **Padrão alvo:** WCAG 2.1 — texto principal **AAA (≥ 7:1)**, texto secundário **AA (≥ 4.5:1)**,
> `prefers-reduced-motion`, foco sempre visível, teclado em tudo que é clicável.
> **Base normativa:** `docs/DESIGN_SYSTEM.md` §8, `docs/UX_PRINCIPLES.md` §2.7/§2.10/§3.5.

Arquivos relacionados:

- `contrast-audit.md` — tabela completa de pares texto/superfície (antes/depois, ratio, veredito).
- `keyboard-aria-checklist.md` — checklist por componente + telas flagship + follow-ups.

---

## Resumo executivo (F10-S05)

### Contraste

- **`--text`** (principal): já passava AAA em ambos os temas — **inalterado**.
- **`--text-mid`** (secundário/labels): dark já AAA; **light elevado** `#4b5b4d → #414e42`
  para atingir AAA em toda superfície (era apenas AA em `surface-3`).
- **`--text-low`** (hint/meta/placeholder): **corrigido nos dois temas**.
  - Dark `#7e867f → #a3aca4`: era 4.26:1 em `surface-3` (falhava AA), agora **≥ 6.84:1 (AA)**
    e AAA na maioria das superfícies.
  - Light `#7e867f → #4e584f`: era 3.10:1 (falhava **até AA**), agora **≥ 6.12:1 (AA)**
    e AAA em `surface`.

Nenhuma cor de marca, estado (danger/warn/info/success) ou superfície foi alterada — a
identidade verde-neon dark-first está intacta. Só os três tokens de **texto** sofreram
ajuste de luminosidade, preservando a matiz verde-acinzentada original.

### Teclado + ARIA

Correções cirúrgicas em `@hm/ui` e `apps/web/shared` (detalhe em `keyboard-aria-checklist.md`):
focus-restore em todos os overlays (Modal, HelpPanel, CommandPalette, Sheet), `aria-live`
para feedback (Input error, Toast), padrão combobox/listbox na paleta de comandos,
**skip-to-content** novo no AppLayout e landmark rotulado na Sidebar.

### Ferramenta de scan (follow-up para o orchestrator)

Este slot **não pôde adicionar dependências** (`package.json` fora da fronteira). A auditoria
de contraste foi feita com cálculo WCAG determinístico (relative luminance / ratio) e a de
teclado/ARIA por inspeção manual + testes de contrato em `packages/ui/src/a11y.test.tsx`.

Para o scan automatizado contínuo em CI, o orchestrator deve instalar:

| Dep | Onde | Para quê |
|---|---|---|
| `vitest` | `packages/ui` (devDep) | rodar `packages/ui/src/a11y.test.tsx` |
| `happy-dom` | `packages/ui` (devDep) | DOM emulado dos testes de componente |
| `@testing-library/react` + `@testing-library/dom` | `packages/ui` (devDep) | render/queries |
| `@testing-library/jest-dom` | `packages/ui` (devDep) | matchers (`vitest.setup.ts`) |
| `@axe-core/playwright` | `apps/web` (devDep) | scan axe nas telas flagship (e2e — F10-S03 owna `e2e/`) |

E adicionar `"test": "vitest run"` em `packages/ui/package.json` + rodar `pnpm install`.
