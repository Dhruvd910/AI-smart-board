"""Liza's 3D view on the website: the same choices the device makes.

The "See it in 3D" button after a reply with no tag (actions.offer_for_topic),
and what a show_visual:model3d becomes (actions._show_model3d via
viewer3d.build_scene):

  * a scene of parts (models3d: the solar system, a cell, a cube with its
    formulas) or of balls and sticks (a molecule, embedded by RDKit) -- plain
    data the page draws with Three.js, turned by a finger as on the device;
  * one of the 3D engine's models (the pendulum, projectile motion, the
    methane molecule) -- the engine needs its own Python and VTK, so its
    models are recorded on the Pi as looping videos by tools/bake_engine.py
    and the page plays the recording;
  * otherwise a flat picture, with the line the device says for it.

The engine's catalogue is bundled (engine_catalog.json, written by
bake_engine.py) and holds only the models that have a recording, so a button
is never offered for something the page cannot show.
"""
import json
import os
import re
import sys

import liza  # noqa: F401  (puts the device's modules on the path)
import models3d
import viewer3d

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, "engine_catalog.json")

# viewer3d reads the engine's catalogue only when the engine's interpreter is
# there; here the recordings stand in for the engine.
viewer3d.ENGINE_CATALOG = CATALOG
viewer3d.ENGINE_PYTHON = sys.executable

TOPIC_SKIP = set(liza.constant("actions.py", "_TOPIC_SKIP"))
LOCAL_TOPICS = [tuple(pair) for pair in liza.constant("actions.py", "_LOCAL_TOPICS")]
# Said when a 3D model was asked for and a picture went up instead.
NO_MODEL_LINES = liza.constant("actions.py", "ACTION_FAILURES")["model3d_picture"]


def topic_payload(question):
    """actions._topic_payload: what in the question can be shown in 3D."""
    text = " " + re.sub(r"[^\w'ऀ-ॿ]+", " ", (question or "").lower()) + " "
    for pattern, builder in models3d.GEOMETRY:
        if re.search(pattern, text):
            return builder(text)["title"] if builder else None
    catalogue = viewer3d.engine_catalog()
    names = sorted(((alias, info.get("name") or alias) for info in catalogue.values()
                    for alias in info.get("aliases", [])
                    if len(alias) > 3 and alias not in TOPIC_SKIP),
                   key=lambda pair: len(pair[0]), reverse=True)
    for alias, _name in names:
        if f" {alias} " in text:
            return alias
    for pattern, payload in LOCAL_TOPICS:
        if re.search(pattern, text):
            return payload
    return None


def offer_for_topic(question, make_offer, hindi=False, on_board=None):
    """actions.offer_for_topic: a button for what the question is about."""
    payload = topic_payload(question)
    if not payload:
        return None
    current = on_board or {}
    words = set(re.findall(r"\w+", payload.lower()))
    if current.get("kind") == "model3d" and words <= set(
            re.findall(r"\w+", (current.get("title") or "").lower())):
        return None     # it is on the board already
    return make_offer("model3d", payload, hindi)


def _plain(value):
    """Scenes carry numpy numbers and tuples; JSON wants lists and floats."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if hasattr(value, "tolist"):
        return _plain(value.tolist())
    if isinstance(value, float):
        return round(value, 5)
    return value


def build(payload):
    """(scene, "") or (None, why) -- viewer3d.build_scene, for the page."""
    scene, why = viewer3d.build_scene(payload)
    if scene is None:
        return None, why
    if scene.get("kind") == "file":
        return None, "there is no model of it here"
    if scene.get("kind") == "engine":
        info = viewer3d.engine_catalog().get(scene["model_id"], {})
        scene["video"] = info.get("video")
        scene["still"] = info.get("still")
        scene["size"] = info.get("size")
        scene["settings"] = info.get("settings", [])
        scene["takes"] = info.get("takes", [])
        if not scene["video"]:
            return None, "there is no recording of it here"
    return _plain(scene), ""


def board_title(scene):
    """What ON_BOARD says is up -- actions._show_model3d's title."""
    title = f"3D model of {scene['title']}"
    if scene.get("formulas"):
        title += " (" + "; ".join(scene["formulas"]) + ")"
    if scene.get("kind") == "engine":
        parts = list(viewer3d.engine_catalog().get(scene["model_id"], {})
                     .get("parts", {}).values())
        title += " (the 3D engine's" + (f"; parts: {', '.join(parts[:16])}" if parts else "") + ")"
    return title
