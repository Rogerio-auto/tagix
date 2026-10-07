# ADR-002 — Tipografia do DS 3.0 (reversão declarada do §14 do DS v2)

> **Status:** aceita · **Data:** 2026-10-07 · **Fase:** F72
> **Decisor:** Rogério
> **Contexto:** [`../DESIGN_SYSTEM_V3_DELTA.md`](../DESIGN_SYSTEM_V3_DELTA.md) §2 e §8 (opção C)

## Decisão

| Papel | DS v2 (até F71) | DS 3.0 (a partir da F72) |
|---|---|---|
| Títulos | Rajdhani 600 | **Space Grotesk 600**, tracking −4,5% (display) / −3,5% (heading) |
| Corpo | Manrope 400 · 17px · lh 1,6 | **Manrope 500 · 16px · lh 1,65** |
| Números / dado | Chakra Petch | **IBM Plex Mono 500**, `tabular-nums` |
| Display / selo | Orbitron | **removida**: a marca vive no logotipo (SVG), não numa família |

Quatro famílias viram três.

## Por quê

- **Reversão consciente.** O §14 do DS v2 trocou Space Grotesk por Rajdhani, mas o v2 nunca foi validado em uso real. Rajdhani é condensada demais para tabela densa e para o corpo da inbox.
- **Corpo em 16px, não 15px como na maquete.** É mais denso que os 17px de hoje sem cansar quem lê o CRM o dia inteiro. Também respeita o piso de 16px em input no iOS (`MOBILE_UX` §1.5), que evita o zoom automático.
- **Mono para número.** Coluna numérica alinha (`tabular-nums`), o que é ganho real em tabela, KPI e preço.
- **Menos uma família:** menos bytes de fonte e menos decisões por tela.

## Consequências

- Os tokens mantêm os **nomes semânticos do v2**: `--font-head` e `--font-body`; `--font-price` vira alias de `--font-mono`, e `--font-display` vira alias de `--font-head`. Nenhum componente quebra por nome. O que muda é o valor.
- Toda tela é repintada (fonte e cor). Por isso a F72 tem varredura de telas e auditoria final de acessibilidade em dois temas.
- O §14 do `DESIGN_SYSTEM.md` ganha a entrada v2 → v3 apontando para este ADR.
