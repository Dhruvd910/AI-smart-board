"""The Transcribe Board's pictures and buttons, drawn by the device's own code.

Her reply ends with at most one action tag, as on the device. The ones that
put something on the board -- show_visual, offer_visual -- are done here with
visuals.py, solution.py and science.py exactly as actions.py does them, so the
diagram, the molecule, the worked solution or the picture is the very same
image the Pi shows. The rest (ui_mode, sleep, board_open, camera_off, ...) are
handed to the page, which does what the device's screen would.

visuals.py draws into one fixed file and its picture fallback asks
`assistant.openrouter_client` for an image; both are provided for here, so the
device modules run unchanged.
"""
import base64
import io
import os
import re
import sys
import tempfile
import threading
import types

import settings
import liza  # noqa: F401  (puts the device's modules on the path)

# visuals._generate_picture imports `assistant` for its OpenRouter client. The
# real assistant module is the whole device; this stands in for that one name.
if "assistant" not in sys.modules:
    from openai import OpenAI
    _shim = types.ModuleType("assistant")
    _shim.openrouter_client = OpenAI(api_key=settings.OPENROUTER_API_KEY or "missing",
                                     base_url="https://openrouter.ai/api/v1", timeout=40)
    sys.modules["assistant"] = _shim

import visuals   # noqa: E402
import solution  # noqa: E402
import model3d   # noqa: E402
import geometry  # noqa: E402
import models3d  # noqa: E402
import geolab    # noqa: E402

# The device's fonts, shipped with the backend: a cloud server has none, and
# visuals.py then falls back to a tiny bitmap font.
_FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
if os.path.isdir(_FONTS):
    visuals._FONT_CANDIDATES.insert(0, os.path.join(_FONTS, "DejaVuSans-Bold.ttf"))
    visuals._FONT_CANDIDATES_REGULAR.insert(0, os.path.join(_FONTS, "DejaVuSans.ttf"))
    visuals._DEVANAGARI_FONT = {True: os.path.join(_FONTS, "NotoSansDevanagari-Bold.ttf"),
                                False: os.path.join(_FONTS, "NotoSansDevanagari-Regular.ttf")}
    visuals._MIXED_FONT = os.path.join(_FONTS, "Lohit-Devanagari.ttf")
    visuals._font_cache.clear()

_lock = threading.Lock()
_dir = os.path.join(tempfile.gettempdir(), "liza-visuals")
os.makedirs(_dir, exist_ok=True)
visuals.VISUAL_DIR = _dir
visuals.VISUAL_PATH = os.path.join(_dir, ".visual.png")

# actions.py's own sets.
STEPPED_KINDS = {"cycle", "steps", "flow", "diagram"}
DESCRIBED_KINDS = {"equation", "formula", "maths", "reaction", "molecule", "report",
                   "forces", "circuit", "model3d"}
RE_TAG = re.compile(r"\[ACTION:\s*([a-z_0-9]+)\s*(?::\s*(.*?))?\s*\]", re.I | re.S)

# What the page does itself: the device's screen-side actions.
PAGE_ACTIONS = {"hide_visual", "enlarge_visual", "shrink_visual", "ui_mode", "sleep",
                "board_open", "board_close", "camera_off", "look"}
# What only the device can do.
DEVICE_ONLY = {"open_file", "close_file", "list_files", "run_command", "stop_media"}


def first_tag(text):
    """(name, param) for the first tag in a reply, or (None, None) --
    actions.parse_action: one action per reply."""
    match = RE_TAG.search(text or "")
    if not match:
        return None, None
    return match.group(1).lower(), (match.group(2) or "").strip().strip("\"'.,!?।")


def _png_url(path):
    with open(path, "rb") as handle:
        data = handle.read()
    return "data:image/png;base64," + base64.b64encode(data).decode()


def steps_for(kind, payload):
    """actions.visual_steps: the stage labels drawn under the picture."""
    if kind.lower() not in STEPPED_KINDS:
        return []
    parts = visuals._split_labels(payload)
    return parts[1:] if len(parts) > 2 else parts


def make_offer(kind, payload, hindi=False, settings=()):
    """actions.make_offer: one button -- what it shows, what it says, and
    the simulation's numbers to set once it is up."""
    kind = visuals.resolve_kind(kind)
    words, sub = visuals.offer_label(kind, payload, hindi)
    return {"kind": kind, "payload": payload, "settings": [list(pair) for pair in settings or ()],
            "label": words, "sub": sub}


def offers_from(param, hindi=False):
    """offer_visual:<kind> | <payload> || ... -- up to three."""
    offers = []
    for chunk in (param or "").split("||")[:3]:
        kind, _, payload = chunk.partition("|")
        if not payload.strip():
            kind, _, payload = chunk.strip().partition(" ")
        if kind.strip() and payload.strip():
            offers.append(make_offer(kind.strip(), payload.strip(), hindi))
    return offers


def show(param, hindi=False, lab=False):
    """actions.show_visual_action, minus the parts that are the device's
    screen: returns {"visual": {...}} and maybe {"offers": [...]}, or
    {"error": "a phrase to say"}. `lab`: the page can draw the geometry lab
    (js/geolab.js); pages from before it get the flat drawing instead."""
    kind, _, payload = (param or "").partition("|")
    if not payload.strip():
        kind, _, payload = (param or "").strip().partition(" ")
    kind, payload = visuals.resolve_kind(kind.strip()), payload.strip()
    if kind == "solution":
        return _solution(payload, hindi)
    # A geometry solid or a flat figure goes to the lab, where it is turned
    # and its corners, edges and faces tapped and measured -- a cube asked for
    # "in 3D" included (actions.show_visual_action, _show_geometry).
    head = payload.split(";")[0]
    if lab and (kind == "geometry"
            or (kind == "model3d" and _geometry_solid(head))
            or (kind == "shape" and geometry.flat_name(head) and not _geometry_solid(head))):
        lab = geolab.build(payload)
        if lab is not None:
            return {"visual": {"kind": "geometry", "title": lab["describe"], "steps": [],
                               "geometry": lab}}
        kind = "shape"
    # A formula is a live graph with its numbers on sliders, as on the device:
    # actions.show_visual_action asks plot_spec first, for any kind.
    if kind == "geometry":
        kind = "shape"
    drawn = graph(payload, kind=kind) if kind != "model3d" else None
    if drawn is not None:
        return {"visual": {"kind": "graph", "title": drawn["describe"], "steps": [], "graph": drawn}}
    # A 3D model (actions._show_model3d): a scene the page draws and turns, or
    # the engine's recording -- and when there is none, a picture of the thing,
    # said out loud, since her reply has usually promised a 3D model already.
    no_model = None
    if kind == "model3d":
        try:
            scene, why = model3d.build(payload)
        except Exception as exc:
            print(f"[3D] Building the model of {payload!r} failed: {exc}", flush=True)
            scene, why = None, "the model did not come out right"
        if scene is not None:
            return {"visual": {"kind": "model3d", "title": model3d.board_title(scene),
                               "steps": [], "scene": scene, "payload": payload[:200]}}
        print(f"[3D] No 3D model of {payload!r} ({why}); showing a picture.", flush=True)
        kind = "picture"
        no_model = model3d.NO_MODEL_LINES["hi" if hindi else "en"]
    with _lock:
        path, why = visuals.render_visual(kind, payload)
        if path is None:
            return {"error": why or "that did not come out right"}
        image = _png_url(path)
    if no_model:
        return {"visual": {"kind": "picture", "steps": [], "image": image,
                           "title": f"{payload[:120]} -- a flat picture: there is no 3D model "
                                    f"of it on this device"},
                "say": no_model}
    title = payload[:200] if kind in DESCRIBED_KINDS else None
    return {"visual": {"kind": kind, "title": title, "steps": steps_for(kind, payload),
                       "image": image}}


def _geometry_solid(head):
    try:
        return models3d.find_solid(head) is not None
    except Exception:
        return False


def _solution(payload, hindi):
    worked = solution.parse(payload)
    if worked is None:
        return {"error": "there was no working to write out"}
    with _lock:
        path, why = visuals.render_visual("solution", payload)
        image = _png_url(path) if path else None
    out = {}
    if image:
        out["visual"] = {"kind": "solution", "title": solution.describe(worked),
                         "steps": solution.step_labels(worked), "image": image}
    else:
        out["error"] = why or "that did not come out right"
    if worked.see:
        kind, see_payload, settings = worked.see
        out["offers"] = [make_offer(kind, see_payload, hindi, settings)]
    return out


# ----- what is on the screen, for her device state -----

def on_board_line(screen):
    """actions.on_board_line, from what the page reports."""
    visual = (screen or {}).get("visual") or {}
    if (screen or {}).get("camera"):
        return ("your live camera view -- it stays until they want it off "
                "(or the board wiped): then camera_off, never hide_visual")
    kind = visual.get("kind")
    if not kind:
        return None
    if kind == "solution":
        return f"{visual.get('title')} -- step by step, each step lit as you say it"
    steps = [s for s in visual.get("steps") or [] if isinstance(s, str)][:12]
    if steps:
        return f"a {kind} diagram, its stages in this order: " + "; ".join(steps)
    title = visual.get("title")
    return f"a {kind}" + (f" of {title}" if title else "")


def offers_line(screen):
    """actions.offers_line."""
    offers = [o for o in (screen or {}).get("offers") or [] if isinstance(o, dict)][:3]
    if not offers:
        return "None"
    return ("on the screen now, waiting for a tap: "
            + "; ".join(f"{i}) {o.get('label')} -- {o.get('kind')} | {str(o.get('payload'))[:90]}"
                        for i, o in enumerate(offers, 1))
            + ". If they say yes or ask for one, show_visual it with that payload")


# ----- the full-screen whiteboard (whiteboard.py and solution.Panel) -----

import whiteboard  # noqa: E402

WB_TOP, WB_BOTTOM = 52, 432
PAGE_SIZE = (800, WB_BOTTOM - WB_TOP)
WB_PANEL_W = 338          # ui.py WB_PANEL_W


def _strokes(raw):
    """The page's lines as whiteboard.py takes them: (points, colour, width, erase),
    points from the page's top-left corner."""
    out = []
    for item in (raw or [])[:600]:
        try:
            points, colour, width, erase = item
            pts = tuple((float(x), float(y)) for x, y in points[:4000])
            out.append((pts, str(colour), float(width), bool(erase)))
        except (TypeError, ValueError):
            continue
    return tuple(out)


def _url(image):
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def sketch(raw):
    """whiteboard.snapshot: the page as she is shown it, or None."""
    image = whiteboard.snapshot(_strokes(raw), PAGE_SIZE)
    return _url(image) if image is not None else None


def read_page(raw, hindi=False):
    """whiteboard.Reader._run: what is written, the figure measured, and the
    buttons that go up under the writing."""
    strokes = _strokes(raw)
    found = dict(whiteboard.EMPTY_READING)
    image = whiteboard.snapshot(strokes, PAGE_SIZE)
    if image is not None:
        found = whiteboard.read(image)
    measured = None
    if found.get("read"):
        try:
            measured = whiteboard.measure_drawing(strokes, found)
        except Exception as exc:
            print(f"[BOARD] Could not measure the figure ({exc}).", flush=True)
    if measured:
        found = dict(found, measure=dict(measured, name=found.get("shape") or ""),
                     measure_names=whiteboard.figure_names(measured))
    try:
        found["suggest"] = whiteboard.suggestions(found, hindi) if found.get("read") else []
    except Exception as exc:
        print(f"[BOARD] No buttons for that reading ({exc}).", flush=True)
        found["suggest"] = []
    return found


def panel(payload, sentences):
    """solution.Panel, drawn: its title, the column with each step lit in
    turn, where each step sits in it, its "see" button -- and which step each
    of her spoken sentences belongs to (solution.match_step), so the page
    lights them as she says them."""
    worked = solution.parse(payload)
    if worked is None:
        return None
    with _lock:
        p = solution.Panel(worked, WB_PANEL_W)
        column, spans = p.image(-1)
        columns = [_url(column)]
        # One more per lit row: every step, and the answer after them.
        for step in range(len(spans)):
            columns.append(_url(p.image(step)[0]))
        title = _url(p.title) if p.title is not None else None
    steps, current = [], -1
    for line in sentences:
        current = solution.match_step(p.tokens, current, line)
        steps.append(current)
    see = None
    if p.see:
        kind, see_payload, _settings = p.see
        see = {"kind": kind, "payload": see_payload, "label": p.see_text}
    return {"title": title, "columns": columns, "spans": spans, "see": see,
            "sentence_steps": steps}


# ----- the live graph (ui.py show_graph, with visuals.plot_spec / sample) -----

GRAPH_LINE = "#1D4ED8"


def _spec(payload, kind="graph"):
    try:
        return visuals.plot_spec(kind, payload)
    except Exception as exc:
        print(f"[GRAPH] Could not read the formula: {exc}", flush=True)
        return None


def _heading(spec, values):
    """ui.py _graph_heading."""
    curves = spec.get("curves") or [{"label": spec["source"]}]
    heading = spec.get("title") or ""
    if len(curves) == 1:
        label = curves[0].get("label") or spec["source"]
        if spec["knobs"] and all(isinstance(k["key"], int) for k in spec["knobs"]):
            label = visuals.formula_label(visuals.describe(spec, values).replace(" * ", "*"))
        heading = f"{heading}: {label}" if heading else label
    return heading


def _num(v):
    return None if v is None or v != v or v in (float("inf"), float("-inf")) else round(float(v), 5)


def graph(payload, values=None, window=None, aspect=None, kind="graph"):
    """Everything the page needs to draw the graph card for these slider
    values: the curves as points (None = lift the pen), and -- the first time
    -- the window, which then stays put while a slider is dragged."""
    spec = _spec(payload, kind)
    if spec is None:
        return None
    knobs = spec["knobs"]
    if not values or len(values) != len(knobs):
        values = [k["value"] for k in knobs]
    values = [float(v) for v in values]
    curves = spec.get("curves") or [{"label": spec["source"], "colour": GRAPH_LINE}]
    relation = any(c.get("relation") for c in curves)
    if window is None:
        shape = {"aspect": aspect} if relation and aspect else {}
        low, high = visuals.y_window(spec, values, **shape)
        left, right = spec["x_low"], spec["x_high"]
        if shape:
            same = (high - low) / aspect
            if same > right - left:
                middle = (left + right) / 2
                left, right = middle - same / 2, middle + same / 2
        window = [left, right, low, high]
    left, right, low, high = window
    drawn = []
    for index, curve in enumerate(curves):
        if curve.get("relation"):
            runs = [[[_num(x), _num(y)] for x, y in run]
                    for run in visuals.trace(spec, values, index, (left, right, low, high), 1.0)]
            drawn.append({"label": curve.get("label"), "colour": curve.get("colour") or GRAPH_LINE,
                          "runs": runs})
        else:
            points = [[_num(x), _num(y)] for x, y in visuals.sample(spec, values, index)]
            drawn.append({"label": curve.get("label"), "colour": curve.get("colour") or GRAPH_LINE,
                          "points": points})
    return {"source": spec["source"], "payload": payload, "kind": kind,
            "knobs": [{k: knob.get(k) for k in ("label", "low", "high", "step", "colour")}
                      for knob in knobs],
            "values": values, "window": window, "heading": _heading(spec, values),
            "x_ticks": [[_num(v), w] for v, w in (spec.get("x_ticks") or [])] or None,
            "describe": visuals.describe(spec, values), "curves": drawn}
