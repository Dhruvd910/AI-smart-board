"""The Kindergarten content the pages use, from kg_content.py.

Served at /api/kg, and also written into the pages as data/kg.json by
web/tools/build_kg.py, so the KG screens open without asking the server.
"""
from liza import kg_content
import liza  # noqa: F401  (the device's modules on the path)
import kg_story_stage  # noqa: E402  (plain Python: the plan, not the drawing)
import kg_workbook  # noqa: E402  (its word banks only; the screens are TutorUI's)


def _stories(language):
    out = []
    for story in kg_content.stories_for(language):
        # segments are (line, delivery) pairs; the answer is yes (True) or no.
        out.append({"title": story.get("title"),
                    "segments": [[s[0], s[1]] if isinstance(s, (list, tuple)) else [str(s), "storyteller"]
                                 for s in story.get("segments") or []]
                    or [[story.get("text", ""), "storyteller"]],
                    "question": story.get("question"), "answer": bool(story.get("answer")),
                    # The story stage (kg_story_stage.plan_story): which cast, and per
                    # line (action, actor, other actor, sky).
                    "cast": kg_story_stage.STORY_CAST.get(story.get("title")),
                    "stage": kg_story_stage.plan_story(story)})
    return out


def content():
    return {
        "count_max": kg_content.COUNT_MAX, "count_block": kg_content.COUNT_BLOCK,
        "count_emoji": kg_content.COUNT_EMOJI,
        "number_names": [kg_content.number_name(n, "en") for n in range(0, kg_content.COUNT_MAX + 2)],
        "english": [{"letter": l, "word": w, "picture": p,
                     "spoken": kg_content.spoken_word(w),
                     "sound": kg_content.letter_sound(l)}
                    for l, w, p in kg_content.ENGLISH_ALPHABET],
        "hindi": [{"letter": l, "word": w, "roman": r, "picture": p}
                  for l, w, r, p in kg_content.HINDI_ALPHABET],
        "numbers": [{"en": en, "hi": hi} for en, hi in kg_content.NUMBER_NAMES],
        "spelling": kg_content.SPELLING_WORDS,
        "stories": {"en": _stories("en"), "hi": _stories("hi")},
        "casts": kg_story_stage.CASTS, "side_on": sorted(kg_story_stage.SIDE_ON),
        # The workbook's banks, from kg_workbook so the pages stay in step with it.
        "workbook": {
            "counters": kg_workbook.COUNTERS, "body_parts": kg_workbook.BODY_PARTS,
            "body_uses": kg_workbook.BODY_USES,
            "body_near": {k: sorted(v) for k, v in kg_workbook.BODY_NEAR.items()},
            "spelling": kg_workbook.SPELLING_TOPICS, "match_modes": kg_workbook.MATCH_MODES,
            "pages": kg_workbook.PAGES,
            "alphabet_words": {l: kg_content.words_for_letter(l) for l, _w, _p in kg_content.ENGLISH_ALPHABET},
        },
        "praise": {"en": kg_content.PRAISE, "hi": kg_content.HINDI_PRAISE,
                   "count": kg_content.COUNT_PRAISE,
                   "story": kg_content.STORY_PRAISE,
                   "story_hi": kg_content.HINDI_STORY_PRAISE,
                   "encourage": kg_content.ENCOURAGEMENT},
    }


# ----- the KG checks, exactly as the device marks them -----

def check(fn, args):
    """One of kg_content's marking functions, by name."""
    a = list(args or [])
    if fn == "heard_spelling":
        verdict, letters = kg_content.heard_spelling(str(a[0] or ""), str(a[1]))
        return {"verdict": verdict, "letters": letters}
    if fn == "matches_answer":
        return {"right": bool(kg_content.matches_answer(str(a[0] or ""), str(a[1])))}
    if fn == "number_matches":
        return {"right": bool(kg_content.number_matches(str(a[0] or ""), int(a[1])))}
    if fn == "spelling_target":
        return {"text": kg_content.spelling_target(str(a[0]))}
    if fn == "spell_out":
        return {"text": kg_content.spell_out(str(a[0]))}
    if fn == "spell_out_spoken":
        return {"text": kg_content.spell_out_spoken(str(a[0]))}
    if fn == "story_verdict":
        story = kg_content.story_by_title(str(a[0]), str(a[1]))
        return {"text": kg_content.story_verdict(story, str(a[1])) if story else ""}
    if fn == "story_praise":
        return {"text": kg_content.story_praise(str(a[0]))}
    raise ValueError(fn)


def test_questions(kind):
    return kg_content.test_questions(kind if kind in ("en", "hi", "count") else "en", 5)
