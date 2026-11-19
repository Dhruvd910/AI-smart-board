"""The parts of Liza the website reuses, imported from the device's own code.

Only leaf modules that import nothing of ours and touch no hardware (see
ARCHITECTURE.md, rule 1): prompts (who she is and every fixed line), spoken
(maths and chemistry said aloud), kg_content (alphabets, words, stories) and
profiles (the grade bands). Reusing them rather than copying keeps the website
and the device saying the same things.

LIZA_DIR is the repository root while developing, and the folder the
Dockerfile copies those files into on Cloud Run.
"""
import os
import sys

import settings

LIZA_DIR = os.getenv("LIZA_DIR", settings.REPO_DIR)
if LIZA_DIR not in sys.path:
    sys.path.insert(0, LIZA_DIR)

# profiles imports store only to save profiles, which the website never asks it
# to do; the band functions used here are pure.
os.environ.setdefault("LIZA_STORE", "0")

import prompts      # noqa: E402
import spoken       # noqa: E402
import kg_content   # noqa: E402
import profiles     # noqa: E402



def constant(filename, name):
    """A constant from one of the device's non-leaf modules (kg.py, ui.py),
    read from its source rather than imported: importing those starts the
    whole device. Keeps the website saying exactly what the device says."""
    import ast
    with open(os.path.join(LIZA_DIR, filename), encoding="utf-8") as handle:
        tree = ast.parse(handle.read())
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else (
            [node.target] if isinstance(node, ast.AnnAssign) else [])
        if any(isinstance(t, ast.Name) and t.id == name for t in targets):
            return ast.literal_eval(node.value)
    raise KeyError(f"{name} not found in {filename}")


__all__ = ["prompts", "spoken", "kg_content", "profiles", "constant"]
