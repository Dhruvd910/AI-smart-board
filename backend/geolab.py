"""The geometry lab on the website: the device's own geometry.py, unchanged.

On the device a `geometry` visual -- or a `model3d` of a solid geometry.py can
measure, or a `shape` that is a flat figure -- opens the lab (actions.
_show_geometry): a figure drawn on the canvas, turned by a finger, whose
corners, edges and faces are tapped and measured. Here the page draws and
turns it (js/geolab.js, at ui.py's pixel positions) and taps it, and this file
does what geometry.py does for ui.py: builds the figure, and says what the
picks measure -- the panel's lines in their colours, the marks drawn on the
figure (right angles, arcs, the cut through three corners), the facts, and
lab_line, which is what Liza is told is open and picked.

The page keeps no copy of the maths. It sends back the request the figure was
built from, its picks, and -- only for a flat figure whose corners have been
dragged -- where its corners are now; the figure is built again from that,
which is cheap and leaves nothing to drift.
"""
import re

import liza  # noqa: F401  (puts the device's modules on the path)
import geometry
from liza import prompts

PICK_KINDS = {"vertex": 1, "edge": 2, "segment": 2, "face": 1, "guide": 1,
              "surface": 0, "rim": 0}


def _pick(raw):
    """A pick from the page -- ["edge", 0, 4] -- as geometry.py's tuple, or None."""
    if not isinstance(raw, (list, tuple)) or not raw or raw[0] not in PICK_KINDS:
        return None
    kind, rest = raw[0], list(raw[1:])
    if PICK_KINDS[kind] == 0:
        return (kind, str(rest[0])) if rest else None
    try:
        numbers = [int(v) for v in rest[:PICK_KINDS[kind]]]
    except (TypeError, ValueError):
        return None
    return (kind, *numbers) if len(numbers) == PICK_KINDS[kind] else None


def picks_of(raw):
    out = []
    for item in (raw or [])[:geometry.MAX_PICKS]:
        pick = _pick(item)
        if pick is not None:
            out.append(pick)
    return out


def _valid(figure, picks):
    """Only picks that are parts of this figure."""
    n, faces = len(figure.points), len(figure.faces)
    names = set(figure.groups.values()) | set(figure.rounds)
    out = []
    for p in picks:
        kind = p[0]
        if kind in ("vertex",) and 0 <= p[1] < n:
            out.append(p)
        elif kind in ("edge", "segment") and 0 <= p[1] < n and 0 <= p[2] < n and p[1] != p[2]:
            out.append(p)
        elif kind == "face" and 0 <= p[1] < faces:
            out.append(p)
        elif kind == "guide" and 0 <= p[1] < len(figure.guides):
            out.append(p)
        elif kind in ("surface", "rim") and p[1] in names:
            out.append(p)
    return out


def figure_of(state):
    """The figure the page has open: built from its request, its corners
    where they were dragged to. None when it is not one geometry.py knows."""
    state = state or {}
    figure = geometry.build(str(state.get("payload") or "")[:600])
    if figure is None:
        return None
    points = state.get("points")
    if points and len(points) == len(figure.points) and figure.flat:
        try:
            figure.points = [(float(p[0]), float(p[1]), 0.0) for p in points]
        except (TypeError, ValueError, IndexError):
            pass
    if state.get("reshaped") and figure.flat:
        geometry.reshaped(figure)
    return figure


def _plain(value):
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, float):
        return round(value, 6)
    return value


def drawing(figure):
    """Everything the page needs to draw and hit-test the figure: what
    ui.py's _geo_draw_figure and _geo_hit read off it."""
    return {
        "name": figure.name, "unit": figure.unit, "flat": figure.flat, "kind": figure.kind,
        "points": _plain(figure.points),
        "labels": figure.labels,
        "corners": sorted(figure.corners),
        "faces": figure.faces,
        "face_groups": [figure.groups.get(k) for k in range(len(figure.faces))],
        # Each edge: its ends, the faces beside it, whether it is inside a
        # curved surface, and the rim it is a piece of -- in figure.edges' order.
        "edges": [[a, b, figure.edge_faces.get((a, b), []), (a, b) in figure.smooth,
                   figure.groups.get((a, b))] for a, b in figure.edges],
        "guides": [[name, a, b] for name, a, b in figure.guides],
    }


def _facts(figure):
    """ui.py _geo_facts: with nothing picked, a flat figure's live angles, or
    a solid's counts and formulas."""
    if figure.flat and figure.kind == "flat" and len(figure.faces[0]) <= 10:
        return geometry.live_facts(figure)
    return [figure.title] + figure.facts


def reading(figure, picks):
    """What the picks measure, and what Liza is told about the lab."""
    picks = _valid(figure, picks)
    measured = geometry.measure(figure, picks)
    return {
        "title": figure.title,
        "describe": figure.describe(),
        "picks": [list(p) for p in picks],
        "names": [figure.element_name(p) for p in picks],
        "lines": [[text, colour, bool(bold)] for text, colour, bold in measured.lines],
        "marks": _plain(measured.marks),
        "headline": measured.headline(),
        "facts": _facts(figure),
        "lab_line": geometry.lab_line(figure, picks),
    }


def build(payload):
    """actions._show_geometry: the figure a request names, pointing at what
    its pick = names. None when geometry.py cannot measure it."""
    payload = (payload or "")[:600]
    try:
        figure = geometry.build(payload)
    except Exception as exc:
        print(f"[GEOMETRY] Could not build {payload!r}: {exc}", flush=True)
        figure = None
    if figure is None:
        return None
    picks = geometry.picks_from_words(figure, geometry.picks_in(payload)) or []
    print(f"[GEOMETRY] {figure.title}"
          + (f", pointing at {', '.join(figure.element_name(p) for p in picks)}" if picks else ""),
          flush=True)
    return {"payload": payload, "figure": drawing(figure), **reading(figure, picks),
            # _geo_ask's question, in the student's language.
            "ask_name": re.sub(r"^your\s+", "", figure.name, flags=re.IGNORECASE).lower(),
            "ask": prompts.GEOMETRY_ASK_QUESTIONS, "about": prompts.GEOMETRY_ABOUT_QUESTIONS}


def measure(state, picks):
    """The lab after a tap, a drag or Clear: what the picks now measure."""
    figure = figure_of(state)
    if figure is None:
        return None
    return {**reading(figure, picks_of(picks)),
            "points": _plain(figure.points) if figure.flat else None}


def device_line(lab_line):
    """actions.geometry_line, word for word."""
    if not lab_line:
        return "None (the geometry lab is not open)"
    return (f"OPEN, full screen: {lab_line}. They turn it with a finger and tap corners, "
            "edges and faces; the screen measures what they pick. Explain THAT -- the "
            "numbers are on their screen -- and point at parts with show_visual:geometry "
            "and pick = (rule 7, section I)")


def for_turn(state, text):
    """The lab as a question arrives (assistant.ai_loop): with it open full
    screen, the parts the question names are picked BEFORE she answers, so
    the measurement is in front of her. Returns None with no lab, else
    {"line": GEOMETRY's line, "describe": ON_BOARD's title, "picks": the
    new picks or None}."""
    if not isinstance(state, dict) or not state.get("payload"):
        return None
    try:
        figure = figure_of(state)
    except Exception as exc:
        print(f"[GEOMETRY] {exc}", flush=True)
        figure = None
    if figure is None:
        return None
    picks = _valid(figure, picks_of(state.get("picks")))
    named = None
    if state.get("open") and text:
        try:
            named = geometry.picks_from_words(figure, text, strict=True) or None
        except Exception as exc:
            print(f"[GEOMETRY] Could not read the picks in {text!r}: {exc}", flush=True)
        if named:
            picks = named
            print("[GEOMETRY] Picked from the question: "
                  + ", ".join(figure.element_name(p) for p in named), flush=True)
    return {"line": device_line(geometry.lab_line(figure, picks)), "describe": figure.describe(),
            "picks": [list(p) for p in named] if named else None}
