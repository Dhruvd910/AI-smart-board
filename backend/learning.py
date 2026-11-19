"""actions.note_learning for the website: which concept a question touched,
from the device's own concept list (concepts.json, made by
tools/build_concepts.py), recorded as a "lesson" for the progress screen."""
import json
import os
import re

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "concepts.json")
try:
    with open(_PATH, encoding="utf-8") as handle:
        _DATA = json.load(handle)
except OSError:
    _DATA = {"keywords": [], "names": {}}

# actions.RE_STUCK, word for word.
RE_STUCK = re.compile(
    r"\b(i don'?t (understand|get|know)|i'?m confused|makes no sense|"
    r"still don'?t|can'?t do|too hard|explain again|didn'?t understand)\b",
    re.IGNORECASE)


def lesson_for(text):
    """(topic, detail) to record, or None -- store.detect_concept's matching."""
    lowered = (text or "").lower()
    for word, slug in _DATA["keywords"]:
        if word in lowered:
            name = _DATA["names"].get(slug) or slug.replace("-", " ")
            detail = ("Asked about it and found it hard" if RE_STUCK.search(text or "")
                      else "Asked about it and we went through it")
            return name, detail
    return None
