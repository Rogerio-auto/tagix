# F72 — Adoção do DS 3.0 (Agency OS) no produto

> Status: aprovado (Rogério, 2026-10-07). Escopo: **adoção completa** (opção C do
> [`DESIGN_SYSTEM_V3_DELTA.md`](../DESIGN_SYSTEM_V3_DELTA.md) §8).
> Spec visual: [`docs/design/ds-3.0-agency-os.html`](../design/ds-3.0-agency-os.html) (abrir no navegador).
> Tipografia: [ADR-002](../decisions/ADR-002-tipografia-ds3.md).

## 1. Objetivo

O produto inteiro passa a falar o DS 3.0: superfícies silenciosas, marca precisa, número em mono, movimento que mostra estado, e uma Home que mostra **resultado acontecendo** ("o que mudou" e "precisa da sua atenção") em vez de um painel de cards.

## 2. Decisões travadas (Rogério, 07/10)

1. **Escopo completo:** tokens, `@hm/ui`, shell, Home, inbox, pipeline, calendário e varredura das demais telas.
2. **Tipografia:** Space Grotesk, mais Manrope 500 em 16px, mais IBM Plex Mono. Orbitron sai (ADR-002).
3. **Mobile:** 4 abas fixas (**Home, Inbox, Agenda, Mais**). Funil e o resto vão para "Mais". Resultado vira o topo da Home. `APP_MOBILE_PLAN` §3.1 é ajustado.
4. **Tradução, não cópia.** A paleta do DS 3.0 é **traduzida** para os nomes semânticos que o `tokens.css` já usa. Nunca colar o `:root` da maquete (`DESIGN_SYSTEM_V3_DELTA` §3.1). Tokens novos entram com nome novo, e nenhum token existente é renomeado.
5. **Tema claro corrigido antes de implementar** (`DESIGN_SYSTEM_V3_DELTA` §4):
   - `--text-low` no claro → ~`#5F6A5E` (≥4,5:1);
   - a marca no claro **nunca** é cor de texto; novo token `--brand-text` para texto/ícone de marca, com ≥4,5:1 nos dois temas;
   - tons de status do claro (`--danger`, `--warn`, `--info`, `--success`) com variante própria ≥4,5:1. Isso absorve o F71-S16, que vira obsoleto.
6. **Valores da maquete não são valores de UI.** Corpos de 6 a 9px dentro do `.app-frame` são a maquete reduzida (`DESIGN_SYSTEM_V3_DELTA` §7).
7. **Regras do §07 da maquete viram regra de produto:** não mostrar custo de LLM ou infra a quem não pode agir sobre ele, e separar o visual da agência do visual seguro para o cliente por permissão.
8. **Fora desta fase:** Content Studio, Approvals e Ads performance (F62–F66, F69). A Home reserva o lugar sem inventar dado.

## 3. Mapa de tokens (v2 → valor DS 3.0)

| Token (nome mantido) | Escuro (DS 3.0) | Claro (DS 3.0 corrigido) |
|---|---|---|
| `--bg` | `#070907` | `#F3F6F1` |
| `--bg-alt` | `#0A0D0B` (= `bg-elevated`) | `#EEF2EC` |
| `--surface` / `-2` / `-3` | `#0E120F` / `#131814` / `#192019` | `#FFFFFF` / `#F8FAF7` / `#EEF3EC` |
| `--surface-inset` | derivar entre `bg` e `surface` | idem |
| `--text` / `--text-mid` / `--text-low` | `#F4F7F3` / `#C3CBC1` / `#7E897E` | `#111811` / `#465045` / **`#5F6A5E`** |
| `--border` / `--border-2` / `--border-brand` | `#202920` / `#2A352A` / `rgba(31,255,19,.32)` | `#DDE5DA` / `#CFD9CC` / `rgba(22,224,10,.30)` |
| `--brand-bright` / `--brand-soft` | `#72FF69` / `#B1FFAA` | — |
| **novos:** `--bg-elevated`, `--surface-glass`, `--violet`, `--brand-text`, `--shadow-1..3`, `--glow`, `--r-xl` | ver maquete §foundations | idem, corrigido |
| raios | `--r-xs 7` · `--r-sm 10` · `--r-md 14` · `--r-lg 18` · `--r-xl 24` · `--r-pill` | — |

O nome atual de cada token (ex.: `--text-mid`, `--text-low`) é conferido no `tokens.css` pela S01. A tabela mostra a intenção.

## 4. Slots (ondas)

- **Onda 1:** S01 (tokens, fontes, tipografia e docs).
- **Onda 2:** S02 (`@hm/ui`) ‖ S03 (shell e navegação mobile).
- **Onda 3:** S04 (Home) ‖ S05 (inbox) ‖ S06 (pipeline e calendário) ‖ S07 (varredura do app) ‖ S08 (varredura de auth, plataforma, ajuda e páginas públicas).
- **Onda 4:** S09 (auditoria final: a11y nos dois temas, peso, capturas e revisão de gosto).

## 5. Barra de pronto (todas as slots com UI)

- Capturas 375/768/1440 em dark e light, axe sem violação séria e orçamento de peso (`~/.claude/skills/canone/VERIFICACAO.md`).
- Revisão `/hm-designer` contra a maquete. "Parece template" reprova.
- Nenhum hex, locale ou fuso literal novo (as regras de lint da F59-S08). A dívida existente só diminui.
- `prefers-reduced-motion` respeitado. Movimento contínuo só em estado vivo.
