"""The 3D Explorer's two needs from the backend: answering "Ask Liza" about a
picked part, and telling her what is on screen while it is open.

Both come from holo_manifests.json, the catalogue's verified text, written by
web/tools/build_holo.py. They follow holo/bridge.py's _ask and board_line,
which do the same on the device.
"""
import json
import os
import re

import settings

_PATH = os.path.join(settings.HERE, "holo_manifests.json")
_models = None


def models():
    global _models
    if _models is None:
        try:
            with open(_PATH, encoding="utf-8") as handle:
                _models = json.load(handle)
        except OSError:
            _models = {}
    return _models


def get(model_id):
    return models().get(model_id) if isinstance(model_id, str) else None


def _component(manifest, cid):
    return next((c for c in manifest["components"] if c["id"] == cid), None)


def _language_name(language):
    return {"hi": "simple Hindi (Devanagari script)",
            "hinglish": "Hinglish (Hindi in Roman letters mixed with English)"}.get(language, "simple English")


def _facts(manifest, comp):
    lines = [f"Model: {manifest['title']} ({manifest['visualization_type'].replace('_', ' ')}). "
             f"{manifest['summary']}",
             f"Honesty note: {manifest['fidelity_note']}"]
    if comp:
        lines.append(f"Selected part: {comp['label']}. {comp.get('description') or ''}"
                     + (f" Job: {comp['function']}" if comp.get("function") else "")
                     + (" Facts: " + " ".join(comp["facts"]) if comp.get("facts") else ""))
        if comp.get("parent_id"):
            parent = _component(manifest, comp["parent_id"])
            if parent:
                lines.append(f"It is part of: {parent['label']}.")
    names = ", ".join(c["label"] for c in manifest["components"][:30])
    if names:
        lines.append(f"Parts in this model: {names}.")
    return "\n".join(lines)


def ask_messages(model_id, component_id, question, language):
    manifest = get(model_id)
    if not manifest:
        return None
    comp = _component(manifest, component_id)
    question = (question or "").strip()[:300] or (
        f"What does the {comp['label']} do?" if comp else f"What is this {manifest['title']}?")
    return [
        {"role": "system", "content":
            "You are Liza, a warm tutor and friend talking to a school student who is exploring a 3D model. "
            f"Answer in {_language_name(language)}, in two or three short spoken sentences, no lists, "
            "no markdown. Base the answer on the verified notes below. You may add well-known "
            "school-level science, but if you are not sure, say so instead of guessing. Never claim "
            "the model shows something it does not.\n\n" + _facts(manifest, comp)},
        {"role": "user", "content": question},
    ]


def clean_answer(text):
    return re.sub(r"^(?:ANSWER:|EMOTION:\s*\w+)\s*", "", (text or "").strip()).strip()


def board_line(view):
    """ON_BOARD while the explorer is open; view is what the page reported:
    {"model_id", "selected", "hidden"}."""
    if not isinstance(view, dict):
        return None
    manifest = get(view.get("model_id"))
    if not manifest:
        return None
    selected = view.get("selected")
    comp = _component(manifest, selected) if isinstance(selected, str) else None
    line = (f"the full-screen 3D Explorer showing {manifest['title']} "
            f"({manifest['visualization_type'].replace('_', ' ')}; {manifest['fidelity_note']})")
    groups = manifest.get("groups") or {}
    if comp:
        line += f". They have selected the {comp['label']}: {comp.get('description') or ''}"
    elif selected in groups:
        parts = [c["label"] for c in manifest["components"] if c["id"] in groups[selected]]
        line += f". They have selected the {selected.replace('_', ' ')}: " + ", ".join(parts)
    hidden = [h for h in (view.get("hidden") or []) if isinstance(h, str)][:20]
    if hidden:
        line += ". Hidden: " + ", ".join(hidden)
    if manifest["components"]:
        line += ". Its parts: " + ", ".join(c["label"] for c in manifest["components"][:24])
    return (line + ". The explorer covers the screen, so answer in words. They can say "
            "'show me the <part>', 'hide the <part>', 'zoom in', 'start the tour' or 'close'.")
