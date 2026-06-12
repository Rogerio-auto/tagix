# Auditoria de contraste — tokens de texto (F10-S05)

> Método: WCAG 2.1 relative-luminance + contrast ratio, calculado sobre os hex dos
> tokens em `packages/design-tokens/src/tokens.css`. Limiares: **AAA ≥ 7:1**,
> **AA ≥ 4.5:1** (texto normal). Cada token de texto foi medido contra **todas** as
> superfícies semânticas onde pode aparecer.

## Convenção

- `text` = corpo/títulos principais → alvo **AAA**.
- `text-mid` = texto secundário, labels de form, corpo do HelpPanel → alvo **AAA** (carrega leitura real).
- `text-low` = hints, timestamps, metadados, placeholder → alvo mínimo **AA**, ideal AAA.

---

## DARK (default)

### `--text` `#f2f5f2` — inalterado (já AAA)

| Superfície | Ratio | Veredito |
|---|---|---|
| bg `#050505` | 18.56 | AAA |
| bg-alt `#0a0a0a` | 18.02 | AAA |
| surface `#101311` | 17.02 | AAA |
| surface-2 `#161a17` | 16.01 | AAA |
| surface-3 `#1e231f` | 14.53 | AAA |
| surface-inset `#0c0e0d` | 17.63 | AAA |

### `--text-mid` `#b9c2ba` — inalterado (já AAA)

| Superfície | Ratio | Veredito |
|---|---|---|
| bg | 11.15 | AAA |
| surface | 10.23 | AAA |
| surface-2 | 9.62 | AAA |
| surface-3 | 8.73 | AAA |

### `--text-low` — **CORRIGIDO** `#7e867f → #a3aca4`

| Superfície | Antes | Depois | Veredito (depois) |
|---|---|---|---|
| bg `#050505` | 5.44 (AA) | **8.73** | AAA |
| bg-alt `#0a0a0a` | 5.28 (AA) | **8.48** | AAA |
| surface `#101311` | 4.99 (AA) | **8.01** | AAA |
| surface-2 `#161a17` | 4.69 (AA) | **7.53** | AAA |
| surface-3 `#1e231f` | **4.26 (FALHA AA)** | **6.84** | AA |
| surface-inset `#0c0e0d` | 5.17 (AA) | **8.30** | AAA |

---

## LIGHT

### `--text` `#0c140d` — inalterado (já AAA)

| Superfície | Ratio | Veredito |
|---|---|---|
| bg `#f4f7f4` | 17.35 | AAA |
| surface `#ffffff` | 18.72 | AAA |
| surface-3 `#e5ebe5` | 15.47 | AAA |

### `--text-mid` — **CORRIGIDO** `#4b5b4d → #414e42`

| Superfície | Antes | Depois | Veredito (depois) |
|---|---|---|---|
| bg `#f4f7f4` | 6.70 (AA) | **8.13** | AAA |
| bg-alt `#ecf1ec` | 6.32 (AA) | **7.67** | AAA |
| surface `#ffffff` | 7.23 (AAA) | **8.77** | AAA |
| surface-2 `#f4f7f4` | 6.70 (AA) | **8.13** | AAA |
| surface-3 `#e5ebe5` | **5.98 (AA)** | **7.25** | AAA |
| surface-inset `#ecf1ec` | 6.32 (AA) | **7.67** | AAA |

### `--text-low` — **CORRIGIDO** `#7e867f → #4e584f`

| Superfície | Antes | Depois | Veredito (depois) |
|---|---|---|---|
| bg `#f4f7f4` | **3.47 (FALHA)** | **6.87** | AA |
| bg-alt `#ecf1ec` | **3.28 (FALHA)** | **6.48** | AA |
| surface `#ffffff` | **3.75 (FALHA)** | **7.41** | AAA |
| surface-2 `#f4f7f4` | **3.47 (FALHA)** | **6.87** | AA |
| surface-3 `#e5ebe5` | **3.10 (FALHA)** | **6.12** | AA |
| surface-inset `#ecf1ec` | **3.28 (FALHA)** | **6.48** | AA |

---

## Tokens de marca/estado (referência — não alterados)

| Par | Ratio | Nota |
|---|---|---|
| `text-on-brand` `#04210a` em `brand` `#1fff13` | 12.53 | AAA — texto de botão primário |
| `danger` `#ff4d4d` em `surface` (dark) | 5.72 | AA — usado como ícone/borda, não corpo de texto |
| `warn` em `surface` (dark) | 11.85 | AAA |
| `info` em `surface` (dark) | 7.34 | AAA |
| `success` em `surface` (dark) | 12.07 | AAA |

> `brand` não é usado como **cor de texto longo** sobre superfície (no light teria 1.27:1);
> aparece como fill de botão (com `text-on-brand`), borda, ícone e link curto — usos que não
> exigem AAA de texto-corpo. Mantido como identidade.

---

## Decisão de design

A correção é **apenas de luminosidade** dentro da mesma matiz verde-acinzentada já
estabelecida (`hsl` ~125°, baixa saturação). Não houve troca de família de cor nem perda do
caráter dark-first. O `text-low` no dark ficou um degrau mais claro (continua sub-hierárquico
frente a `text` e `text-mid`); no light desceu para um verde-escuro legível. A hierarquia
visual `text > text-mid > text-low` permanece preservada em ambos os temas.
