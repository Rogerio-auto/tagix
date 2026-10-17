"""Parser incremental de JSON parcial: extrai, em streaming, um campo string de topo.

O modelo emite os argumentos da ferramenta `answer` como uma string JSON fatiada em
deltas arbitrários (`{"verd`, `ict": "Três neg`, `ócios \\u00e9…`). Queremos emitir o
texto do campo `verdict` **assim que cada caractere fica decodificável**, sem esperar o
JSON fechar e sem regex sobre texto parcial (que quebra com escapes, aspas escapadas,
chaves aninhadas ou um `"verdict"` que aparece dentro de outro valor).

`TopLevelStringFieldStreamer` é um autômato de um caractere por vez sobre a gramática
JSON, com estado persistente entre `feed()`s:

- acompanha profundidade (`{`/`[`), se está dentro de string e escape pendente;
- no nível 1 de um objeto, alterna entre "esperando chave" e "esperando valor";
- quando a chave de topo é o campo-alvo e o valor começa com `"`, entra em captura e
  decodifica a string JSON incrementalmente: escapes simples, `\\uXXXX` e pares
  substitutos UTF-16 que chegam partidos entre deltas.

Strings aninhadas (`why[0]`, `sources[].label`) e chaves homônimas em níveis internos
são ignoradas. Depois que a string-alvo fecha, o autômato para de produzir texto.
"""

from __future__ import annotations

from typing import Final

_SIMPLE_ESCAPES: Final = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}
_HEX: Final = frozenset("0123456789abcdefABCDEF")
_REPLACEMENT: Final = "�"


class TopLevelStringFieldStreamer:
    """Decodifica incrementalmente o valor string de um campo de topo de um objeto JSON."""

    def __init__(self, field: str) -> None:
        self._field = field
        self._depth = 0
        self._in_string = False
        self._escape = False
        # Estado de nível 1 do objeto de topo.
        self._expect_key = False
        self._key_chars: list[str] | None = None
        self._last_key: str | None = None
        self._after_colon = False
        # Captura do valor-alvo.
        self._capturing = False
        self._pending_escape = ""  # escape incompleto do valor-alvo (`\`, `\u00`...)
        self._high_surrogate: int | None = None
        self.done = False
        self.started = False

    # ------------------------------------------------------------------ API
    def feed(self, chunk: str) -> str:
        """Consome um delta e devolve o texto decodificado novo do campo-alvo."""
        if self.done or not chunk:
            return ""
        out: list[str] = []
        for ch in chunk:
            if self._capturing:
                self._capture_char(ch, out)
                if self.done:
                    break
                continue
            self._scan_char(ch)
        return "".join(out)

    # ------------------------------------------------------------ varredura
    def _scan_char(self, ch: str) -> None:
        if self._in_string:
            if self._escape:
                self._escape = False
                if self._key_chars is not None:
                    self._key_chars.append(_SIMPLE_ESCAPES.get(ch, ch))
                return
            if ch == "\\":
                self._escape = True
                return
            if ch == '"':
                self._in_string = False
                if self._key_chars is not None:
                    self._last_key = "".join(self._key_chars)
                    self._key_chars = None
                return
            if self._key_chars is not None:
                self._key_chars.append(ch)
            return

        if ch.isspace():
            return
        if ch == '"':
            self._in_string = True
            if self._depth == 1 and self._expect_key:
                self._key_chars = []
            elif self._depth == 1 and self._after_colon:
                self._after_colon = False
                if self._last_key == self._field:
                    self._in_string = False
                    self._capturing = True
                    self.started = True
            return
        if ch in "{[":
            if self._depth == 1:
                self._after_colon = False
            self._depth += 1
            if self._depth == 1:
                self._expect_key = ch == "{"
            return
        if ch in "}]":
            self._depth = max(0, self._depth - 1)
            return
        if self._depth != 1:
            return
        if ch == ":":
            self._expect_key = False
            self._after_colon = True
            return
        if ch == ",":
            self._expect_key = True
            self._after_colon = False
            self._last_key = None
            return
        # Literal de topo (número, true/false/null): não é o valor-alvo.
        self._after_colon = False

    # ------------------------------------------------------------- captura
    def _capture_char(self, ch: str, out: list[str]) -> None:
        if self._pending_escape:
            self._pending_escape += ch
            self._resolve_escape(out)
            return
        if ch == "\\":
            self._pending_escape = "\\"
            return
        if ch == '"':
            self._flush_dangling_surrogate(out)
            self._capturing = False
            self.done = True
            return
        self._flush_dangling_surrogate(out)
        out.append(ch)

    def _resolve_escape(self, out: list[str]) -> None:
        esc = self._pending_escape
        kind = esc[1]
        if kind != "u":
            self._pending_escape = ""
            self._flush_dangling_surrogate(out)
            out.append(_SIMPLE_ESCAPES.get(kind, kind))
            return
        if len(esc) < 6:
            if not all(c in _HEX for c in esc[2:]):
                # `\u` malformado: descarta o escape em vez de travar o stream.
                self._pending_escape = ""
                out.append(_REPLACEMENT)
            return
        self._pending_escape = ""
        if not all(c in _HEX for c in esc[2:6]):
            out.append(_REPLACEMENT)
            return
        code = int(esc[2:6], 16)
        if 0xD800 <= code <= 0xDBFF:
            self._flush_dangling_surrogate(out)
            self._high_surrogate = code
            return
        if 0xDC00 <= code <= 0xDFFF:
            if self._high_surrogate is None:
                out.append(_REPLACEMENT)
                return
            high = self._high_surrogate
            self._high_surrogate = None
            out.append(chr(0x10000 + ((high - 0xD800) << 10) + (code - 0xDC00)))
            return
        self._flush_dangling_surrogate(out)
        out.append(chr(code))

    def _flush_dangling_surrogate(self, out: list[str]) -> None:
        if self._high_surrogate is not None:
            self._high_surrogate = None
            out.append(_REPLACEMENT)
