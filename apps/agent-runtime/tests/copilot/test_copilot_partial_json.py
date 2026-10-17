"""Parser incremental de JSON parcial e o streamer do veredito."""

from __future__ import annotations

import json
import random

import pytest

from app.copilot.answer import VerdictStreamer, clamp_verdict, split_sentences
from app.copilot.partial_json import TopLevelStringFieldStreamer


def _feed_all(streamer: TopLevelStringFieldStreamer | VerdictStreamer, raw: str, cuts: list[int]):
    out, prev = [], 0
    for cut in [*cuts, len(raw)]:
        out.append(streamer.feed(raw[prev:cut]))
        prev = cut
    return "".join(out)


CASES = [
    {"verdict": "simples"},
    {"verdict": 'aspas "internas" e barra \\ e / e \n quebra'},
    {"verdict": "acentuação é ok — e emoji 📉 também"},
    {"why": ["verdict falso no nível 2"], "data": {"verdict": "aninhado"}, "verdict": "o real"},
    {"sources": [{"label": "x", "verdict": "não"}], "verdict": "depois de array"},
    {"n": 3, "ok": True, "nil": None, "verdict": "depois de literais"},
    {"verdictx": "chave parecida", "verdict": "a certa"},
]


@pytest.mark.parametrize("payload", CASES)
@pytest.mark.parametrize("ensure_ascii", [True, False])
def test_every_split_point_decodes_exactly(payload: dict, ensure_ascii: bool) -> None:
    raw = json.dumps(payload, ensure_ascii=ensure_ascii)
    expected = payload["verdict"]
    for cut in range(len(raw) + 1):
        parser = TopLevelStringFieldStreamer("verdict")
        assert _feed_all(parser, raw, [cut]) == expected, (raw, cut)


@pytest.mark.parametrize("payload", CASES)
def test_char_by_char_decodes_exactly(payload: dict) -> None:
    raw = json.dumps(payload)
    parser = TopLevelStringFieldStreamer("verdict")
    assert _feed_all(parser, raw, list(range(1, len(raw)))) == payload["verdict"]
    assert parser.done


def test_emits_before_the_json_closes() -> None:
    parser = TopLevelStringFieldStreamer("verdict")
    assert parser.feed('{"verdict": "Três neg') == "Três neg"
    assert parser.feed("ócios") == "ócios"
    assert parser.feed('", "why": [') == ""
    assert parser.done


def test_missing_or_non_string_field_yields_nothing() -> None:
    parser = TopLevelStringFieldStreamer("verdict")
    assert parser.feed('{"verdict": 42, "why": ["verdict"]}') == ""
    assert not parser.started


def test_lone_surrogate_becomes_replacement_char() -> None:
    parser = TopLevelStringFieldStreamer("verdict")
    assert parser.feed('{"verdict": "a\\ud83db"}') == "a�b"


def test_random_chunkings_keep_stream_equal_to_clamped_verdict() -> None:
    rng = random.Random(73)
    verdicts = [
        "  borda com espaços  ",
        "linha\ncom\tcontrole",
        ("x" * 219) + " fim",
        ("palavra " * 40).strip(),
        "é" * 230,
    ]
    for verdict in verdicts:
        raw = json.dumps({"verdict": verdict, "why": []})
        for _ in range(50):
            cuts = sorted(rng.sample(range(1, len(raw)), k=min(8, len(raw) - 1)))
            streamer = VerdictStreamer()
            assert _feed_all(streamer, raw, cuts) == clamp_verdict(verdict)
            assert streamer.text == clamp_verdict(verdict)


def test_clamp_verdict_limits() -> None:
    assert clamp_verdict("  a\nb  ") == "a b"
    assert len(clamp_verdict("y" * 500)) == 220


def test_split_sentences_keeps_decimal_points() -> None:
    assert split_sentences("Total de R$ 1.200 em 3.5 dias. Depois! Fim") == [
        "Total de R$ 1.200 em 3.5 dias.",
        "Depois!",
        "Fim",
    ]
