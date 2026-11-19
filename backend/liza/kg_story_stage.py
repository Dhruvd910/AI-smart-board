"""Story animations: the characters act out each line on the blackboard while
Liza reads it.

Each story has a cast -- the crow, the pot, the stones; the tortoise, the hare,
the finishing flag -- and every line of the story is turned into one small
action for one of them: fly, walk, run, drop a stone, drink, sleep, cry, laugh,
shake in a net, think, and so on. The action is picked from the words of the
line itself ("He flew over the fields" -> the crow flies; "Plop! Into the pot"
-> a stone drops into the pot) and, where the words say nothing, from the tone
the line is read in (an excited line hops, a sad one droops).

SYNC. The action for a line runs exactly while that line is in the air. The
timing comes from the caption clock in audio.py -- the same clock that keeps the
caption on the line being read -- so cue n is animated from its own start time
to the next cue's, and a fast or a slow reading stretches the action to fit.

Two halves, like kg_workbook: the PLAN (which action, for whom, on which line)
is plain Python with no Tk, worked out once per story; the STAGE is a mixin,
StoryStage, that TutorUI inherits and that draws the plan on the canvas. Its
methods are prefixed _stage_.
"""

import glob
import json
import math
import os
import random
import re
import sys
import time


def _timeline(session):
    """audio.caption_timeline, imported late: audio imports assistant, which
    imports ui, which imports this module -- at the top it would be a loop."""
    import audio
    return audio.caption_timeline(session)

# ===========================================================================
# The casts
# ===========================================================================
# Each actor: key -> (picture, home x, words that mean them). Words are matched
# at the start of a word, lower case, in English and Hindi alike, so "crow"
# also catches "crow's" and "कौआ" catches "कौए" only if listed.
#
# props: (picture, x, y, size) drawn and left still. target: the prop things
# are dropped into, drunk from or eaten from, as (x, y). item: what gets
# dropped. Pictures are side-on animals wherever the font has one, because a
# side-on animal can turn to face where it is going and a face cannot.

GROUND_Y = 252            # where feet stand on the board

CASTS = {
    "crow": {
        "actors": {"crow": ("\U0001F426", 300, ["crow", "bird", "कौ"])},
        "hero": "crow",
        "props": [("\U0001F3FA", 470, 222, 60)],
        "target": (470, 214), "item": "\U0001FAA8", "water": True,
    },
    "lion_mouse": {
        "actors": {"lion": ("\U0001F981", 470, ["lion", "शेर", "king"]),
                   "mouse": ("\U0001F401", 300, ["mouse", "चूह", "little"])},
        "hero": "mouse",
        "props": [("\U0001F333", 560, 206, 70)],
        "target": (470, 224), "item": "\U0001F578️",
    },
    "ant": {
        "actors": {"ant": ("\U0001F41C", 300, ["ant", "चींटी", "चींटि"]),
                   "grasshopper": ("\U0001F997", 470, ["grasshopper", "टिड्ड"])},
        "hero": "ant",
        "props": [("\U0001F33E", 252, 226, 44)],
        "target": (252, 226), "item": "\U0001F33E",
    },
    "tortoise": {
        "actors": {"tortoise": ("\U0001F422", 280, ["tortoise", "कछु"]),
                   "hare": ("\U0001F407", 360, ["hare", "rabbit", "खरगोश"])},
        "hero": "tortoise",
        "props": [("\U0001F3C1", 572, 222, 40), ("\U0001F333", 470, 206, 64)],
        "target": (572, 222), "finish": 560,
    },
    "wolf": {
        "actors": {"boy": ("\U0001F466", 300, ["boy", "shepherd", "लड़क"]),
                   "wolf": ("\U0001F43A", 560, ["wolf", "भेड़िय"]),
                   "villagers": ("\U0001F9D1", 420, ["villager", "people",
                                                   "everyone", "everybody",
                                                   "baker", "farmer",
                                                   "grandmother", "गाँव"])},
        "hero": "boy",
        "props": [("\U0001F411", 240, 232, 36), ("\U0001F411", 268, 240, 30),
                  ("⛰️", 540, 160, 40)],
        "hidden": ["wolf", "villagers"],
    },
    "hen": {
        "actors": {"hen": ("\U0001F414", 290, ["hen", "मुर्गी"]),
                   "cat": ("\U0001F408", 420, ["cat", "बिल्ल"]),
                   "dog": ("\U0001F415", 500, ["dog", "कुत्त"]),
                   "duck": ("\U0001F986", 570, ["duck", "बत्त"])},
        "hero": "hen",
        "props": [("\U0001F33E", 240, 226, 40)],
        "target": (240, 226), "item": "\U0001F35E",
    },
    "elephant": {
        "actors": {"elephant": ("\U0001F418", 300, ["elephant", "हाथी"]),
                   "monkey": ("\U0001F412", 440, ["monkey", "बंदर"]),
                   "rabbit": ("\U0001F407", 510, ["rabbit", "खरगोश"]),
                   "frog": ("\U0001F438", 570, ["frog", "मेंढ"])},
        "hero": "elephant",
        "props": [("\U0001F333", 236, 206, 64)],
        "hidden": ["monkey", "rabbit", "frog"],
    },
    "goats": {
        "actors": {"goat": ("\U0001F410", 270, ["white"]),
                   "goat2": ("\U0001F410", 550, ["black"])},
        "hero": "goat",
        "props": [],
        "river": True, "log": True,
    },
    "unity": {
        "actors": {"father": ("\U0001F474", 300, ["father", "old", "पिता",
                                                 "बूढ़", "किसान"]),
                   "sons": ("\U0001F466", 470, ["son", "बेट", "भाई"])},
        "hero": "father",
        "props": [("\U0001FAB5", 390, 236, 36)],
        "target": (390, 236), "item": "\U0001FAB5",
    },
    "greedy_dog": {
        "actors": {"dog": ("\U0001F415", 300, ["dog", "कुत्त"])},
        "hero": "dog",
        "props": [("\U0001F9B4", 330, 214, 26)],
        "river": True, "target": (470, 250), "item": "\U0001F9B4",
    },
    "golden_eggs": {
        "actors": {"hen": ("\U0001F414", 470, ["hen", "मुर्गी"]),
                   "farmer": ("\U0001F9D1", 300, ["farmer", "man", "किसान",
                                                 "आदमी", "पति", "पत्नी"])},
        "hero": "hen",
        "props": [("\U0001F3E0", 560, 206, 60)],
        "target": (470, 240), "item": "\U0001F95A", "golden": True,
    },
    "cats_monkey": {
        "actors": {"cat": ("\U0001F408", 260, ["काली", "बिल्ल"]),
                   "cat2": ("\U0001F408", 340, ["सफ़ेद"]),
                   "monkey": ("\U0001F412", 500, ["monkey", "बंदर"])},
        "hero": "cat",
        "props": [("⚖️", 420, 214, 40)],
        "target": (420, 214), "item": "\U0001FAD3",
    },
}

# Which cast each story uses, by its title in either language.
STORY_CAST = {
    "The Thirsty Crow": "crow", "प्यासा कौआ": "crow",
    "The Lion and the Mouse": "lion_mouse", "शेर और चूहा": "lion_mouse",
    "The Ant and the Grasshopper": "ant", "चींटी और टिड्डा": "ant",
    "The Tortoise and the Hare": "tortoise", "कछुआ और खरगोश": "tortoise",
    "The Boy Who Cried Wolf": "wolf",
    "The Little Red Hen": "hen",
    "The Elephant and the Friends": "elephant",
    "The Two Goats": "goats",
    "एकता में बल": "unity",
    "लालची कुत्ता": "greedy_dog",
    "सोने के अंडे": "golden_eggs",
    "दो बिल्लियाँ और बंदर": "cats_monkey",
}

# Side-on pictures. They all face LEFT in Noto, so one moving right is shown
# mirrored. Faces (the lion, the boy) look at the child and never turn.
SIDE_ON = {"\U0001F426", "\U0001F41C", "\U0001F997", "\U0001F422", "\U0001F407",
           "\U0001F414", "\U0001F408", "\U0001F415", "\U0001F986", "\U0001F418",
           "\U0001F412", "\U0001F410", "\U0001F401", "\U0001F411"}

# ===========================================================================
# Words -> actions
# ===========================================================================
# First match wins, so the specific ("drank") comes before the general
# ("went"). Each pattern is tried against the line in lower case.
ACTION_RULES = [
    # Laughing first: "he fell over laughing" and "laughed so hard the leaves
    # shook" are both about laughing, not falling or shaking.
    ("happy",    r"laugh|हँस|हंस|ठहाक"),
    ("hop",      r"\bwins?\b|\bwon\b|जीत|cheer"),
    ("drop",     r"\bplop|\bthrew|\bthrow|\btoss|डाल|फेंक|छपाक|splash"),
    ("fall",     r"\bfell\b(?! apart)|\bfall|tumbl|गिर"),
    ("rise",     r"higher|\brose\b|rising|climbing up|ऊपर आ|ऊपर उठ"),
    ("drink",    r"\bdrank|\bdrink|\bsip|पिया|पीने|पी लिया|पीता"),
    ("eat",      r"\bate\b|\beat|munch|nibbl|\bchew|\bgnaw|खाया|खाने|खा ल|खाए|कुतर"),
    ("fly",      r"\bfl(y|ew|ies)\b|\bflap|\bwings?\b|उड़"),
    ("sleep",    r"\bsleep|\bslept|asleep|\bnap\b|\bsnor|\byawn|\bdream|lay down|"
                 r"shut (his|her) eyes|\brest\b|सो ग|सोया|सो जा|नींद|झपकी|आराम"),
    ("run",      r"\bran\b|\brun|\brac(e|ed|ing)\b|\bdash|\bzoom|\bfast\b|hurr|\brush|"
                 r"\bchas|\bflying\b|\bscamper|दौड़|भाग|तेज़"),
    ("shake",    r"\bshook|\bshak|\btrap|\bnet\b|caught|scared|afraid|\broar|angry|"
                 r"\bshout|trembl|\bpulled|\btwist|जाल|फँस|फंस|डर|दहाड़|गुस्स|चिल्ला|झगड़|लड़"),
    ("think",    r"\bthought|\bthink|\bidea\b|wonder|\bplan|सोच|तरकीब|उपाय"),
    ("sad",      r"\bcr(y|ied)\b|\btears?\b|\bsad\b|hungry|thirst|tired|alone|"
                 r"रोता|रोने|रोया|रोई|भूख|प्यास|थक|उदास|अकेल|पछता"),
    ("happy",    r"happy|\bsmil|\bjoy|\bfriend|thank|\bhug|\blove|danc|\bsing|"
                 r"\bplay|खुश|दोस्त|धन्यवाद|नाच|गाना|गाने|गाया|मुस्कु"),
    ("together", r"together|\bmet\b|\bmeet|\bboth\b|एक साथ|मिलकर"),
    ("walk",     r"\bwalk|\bstep|\bslow|\bcrawl|\bplod|\bwent\b|\bcame\b|wander|march|"
                 r"चलने|चला|चली|चलते|धीरे|कदम"),
    ("sparkle",  r"\bgold|shining|magic|amaz|\bwow\b|सोन|चमक"),
    ("talk",     r"\bsaid\b|\bsays\b|\basked|\btold\b|\bcalled|\breplied|whisper|"
                 r"squeak|बोल|कहा|पूछ"),
]

# What the weather or the light is doing -- drawn behind the action, and kept
# on from the line that brings it until a line brings another.
SKY_RULES = [
    # Only words that set a SCENE: "one night", "winter". "All morning, all
    # evening" is about how long the grasshopper played, not about the light.
    ("night", r"one (night|evening)|that night|in the dark|\bmoon|"
              r"रात को|रात में|शाम के|शाम को|अँधेर|अंधेर"),
    # Not "winter is coming": it is still summer on that line.
    ("snow",  r"winter (came|had come|arrived)|\bsnow|the cold came|"
              r"सर्दी आ गई|ठंड आ गई|बर्फ"),
    ("rain",  r"\brains? came|\brain\b|storm|बारिश"),
    ("sun",   r"\bsun\b|\bhot\b|summer|one morning|next morning|गर्मी|धूप|सूरज|सुबह"),
]
# Rain is a passing thing: it falls on the line that brings it, then stops.
PASSING_SKY = {"rain"}

# Where the words mislead: line number -> (action, actor, other). None keeps
# what the rules chose. Mostly "who is HE" -- the line names the tortoise but
# is about the hare looking back at him -- and one story-shaped trap: the boy
# shouting about a wolf must not make a wolf appear.
OVERRIDES = {
    "The Boy Who Cried Wolf": {
        6: ("shake", "boy", None), 7: ("run", "villagers", None),
        8: ("run", "villagers", None), 9: ("run", "villagers", None),
        10: ("walk", "villagers", None), 11: ("look", "villagers", None),
        13: ("walk", "villagers", None), 15: ("shake", "boy", None),
        16: ("run", "villagers", None), 17: ("look", "villagers", None),
        18: ("sad", "villagers", None), 19: ("mystery", "boy", None),
        20: ("mystery", "boy", None), 21: ("mystery", "boy", None),
        22: ("walk", "wolf", None), 24: ("shake", "boy", None),
        25: ("shake", "boy", None), 26: ("idle", "villagers", None),
        27: ("eat", "villagers", None), 28: ("shake", "villagers", None),
        29: ("sad", "boy", None),
    },
    "The Tortoise and the Hare": {
        14: ("run", "hare", None), 15: ("run", "hare", None),
        16: ("walk", "tortoise", None), 17: ("look", "hare", None),
        18: ("look", "hare", None), 19: ("think", "hare", None),
        20: ("sleep", "hare", None), 21: ("sleep", "hare", None),
        22: ("walk", "tortoise", None),
        27: ("hop", "hare", None), 30: ("hop", "tortoise", None),
        31: ("happy", "tortoise", None),
    },
    "The Lion and the Mouse": {
        2: ("idle", "lion", None), 20: ("shake", "lion", None),
        27: ("eat", "mouse", "lion"), 28: ("eat", "mouse", "lion"),
        29: ("hop", "lion", None),
    },
    "The Two Goats": {
        0: ("idle", "goat", None), 17: ("shake", "goat", "goat2"),
        18: ("shake", "goat2", "goat"), 19: ("shake", "goat", "goat2"),
        20: ("shake", "goat2", "goat"), 21: ("fall", "goat", "goat2"),
    },
    "The Thirsty Crow": {12: ("drink", "crow", None)},
    "The Elephant and the Friends": {
        14: ("mystery", "elephant", None), 18: ("walk", "elephant", None),
    },
}

# When the words say nothing, how the line is read decides.
TONE_ACTION = {
    "excited": "hop", "amazed": "sparkle", "proud": "hop", "sad": "sad",
    "mysterious": "mystery", "curious": "look", "gentle": "idle",
    "warm": "happy", "storyteller": "idle", "encouraging": "hop",
}


def _mentions(text, words):
    low = text.lower()
    for word in words:
        if re.search(r"(^|[^\w])" + re.escape(word), low) or (
                not word.isascii() and word in text):
            return True
    return False


def plan_story(story):
    """[(action, actor, other actor, sky)] for each beat of `story`, or None
    when it has no cast. Worked out once, before the first word is said.

    The actor is whoever the line names; a line that names nobody is about
    whoever the last one named -- "He stretched his neck" is still the crow."""
    cast_key = STORY_CAST.get(story.get("title"))
    if cast_key is None:
        return None
    cast = CASTS[cast_key]
    focus, other = cast["hero"], None
    sky = None
    plan = []
    fixes = OVERRIDES.get(story.get("title"), {})
    for index, (text, tone) in enumerate(story["segments"]):
        named = [k for k, (_p, _x, words) in cast["actors"].items()
                 if _mentions(text, words)]
        if named:
            if named[0] != focus:
                other = focus
            focus = named[0]
            if len(named) > 1:
                other = named[1]
        action = None
        for name, pattern in ACTION_RULES:
            if re.search(pattern, text.lower()):
                action = name
                break
        if action is None:
            action = TONE_ACTION.get(tone, "idle")
        if action == "sad" and tone not in ("sad", "gentle", "mysterious") \
                and re.search(r"thirst|hungry|प्यास|भूख", text.lower()) is None:
            # "Not sad" lines that happen to say "dry" are about the weather.
            action = TONE_ACTION.get(tone, "idle")
        if sky in PASSING_SKY:
            sky = None
        for name, pattern in SKY_RULES:
            if re.search(pattern, text.lower()):
                sky = name
                break
        if index in fixes:
            fixed_action, fixed_actor, fixed_other = fixes[index]
            action = fixed_action or action
            if fixed_actor:
                if fixed_actor != focus:
                    other = focus
                focus = fixed_actor
            if fixed_other:
                other = fixed_other
        if other is None or other == focus:
            other = next((k for k in cast["actors"] if k != focus), None)
        plan.append((action, focus, other, sky))
    return plan


# ===========================================================================
# The stage
# ===========================================================================
STAGE_X0, STAGE_X1 = 222, 596
STAGE_Y0, STAGE_Y1 = 126, 262
ACTOR_PX = 58
FRAME_MS = 50

# Animated characters: the website's LottieFiles animations (web/tools/
# story_lottie.json), pre-rendered to PNG frames by build_lottie_frames, since
# Tk cannot play Lottie. A character with no frames keeps its emoji.
_HERE = os.path.dirname(os.path.abspath(__file__))
LOTTIE_SRC = os.path.join(_HERE, "web", "frontend", "assets", "lottie")
LOTTIE_CACHE_DIR = os.path.join(_HERE, "Animations", "story-2026-11")
LOTTIE_PX = 84            # how tall an animated character stands
# Which way each animation faces as drawn (storystage.js LOTTIE_FACES); it is
# mirrored to face where it is going. Not listed: faces the child, never turns.
LOTTIE_FACES = {"crow": "right", "tortoise": "right", "hare": "right",
                "rabbit": "right", "mouse": "left", "boy": "right",
                "sons": "right", "hen": "left", "cat": "right",
                "cat2": "right", "dog": "right", "duck": "right",
                "elephant": "right", "father": "right", "ant": "left"}
# Actions where the character's own animation plays; otherwise it holds still.
MOVING = {"walk", "run", "fly", "hop", "happy", "eat", "drink", "drop",
          "shake", "together", "look", "talk", "rise", "sparkle"}


def build_lottie_frames():
    """Render every animation in LOTTIE_SRC to LOTTIE_CACHE_DIR/<key>/NNN.png:
    one frame per FRAME_MS, cropped to its drawn area (crops.json), LOTTIE_PX
    tall. Skips characters already rendered."""
    from rlottie_python import LottieAnimation
    with open(os.path.join(LOTTIE_SRC, "crops.json")) as f:
        crops = json.load(f)
    for key, (cx, cy, cw, ch) in crops.items():
        out = os.path.join(LOTTIE_CACHE_DIR, key)
        if glob.glob(os.path.join(out, "*.png")):
            continue
        anim = LottieAnimation.from_file(os.path.join(LOTTIE_SRC, key + ".json"))
        w, h = anim.lottie_animation_get_size()
        fps = anim.lottie_animation_get_framerate()
        total = anim.lottie_animation_get_totalframe()
        s = LOTTIE_PX / ch
        box = (round(cx * s), round(cy * s), round((cx + cw) * s),
               round((cy + ch) * s))
        tmp = out + ".part"
        os.makedirs(tmp, exist_ok=True)
        count = max(1, int(total / fps * 1000 / FRAME_MS))
        kept = 0
        for i in range(count):
            frame = min(total - 1, round(i * FRAME_MS / 1000 * fps))
            image = anim.render_pillow_frame(frame_num=frame, width=round(w * s),
                                             height=round(h * s)).crop(box)
            if image.getbbox():     # some start blank (the hare's first frame)
                image.save(os.path.join(tmp, "%03d.png" % kept))
                kept += 1
        os.replace(tmp, out)
        print(key, kept, "frames")


class StoryStage:
    """The animated board, mixed into TutorUI."""

    def _stage_reset(self, story):
        """Called when a story starts (or is read again): fresh plan, everyone
        back to their places, the hidden ones off stage."""
        self._stage_plan = plan_story(story)
        self._stage_cast = CASTS.get(STORY_CAST.get(story.get("title")))
        self._stage_x = {}
        self._stage_seen = set()
        self._stage_asleep = set()
        if self._stage_cast:
            for key, (_p, x, _w) in self._stage_cast["actors"].items():
                self._stage_x[key] = x
            self._stage_seen = {k for k in self._stage_cast["actors"]
                                if k not in self._stage_cast.get("hidden", [])}
        self._stage_token = getattr(self, "_stage_token", 0) + 1
        self._stage_images = {}
        self._stage_facing = {}     # animated characters: which way they face
        self._stage_step = {}       # and how far into their animation
        # The crow's pot starts nearly empty and fills stone by stone.
        self._stage_water = self._stage_water_base = 0.15

    def _stage_image(self, picture, px, mirror=False):
        """A PhotoImage of `picture`, cached for the story -- a frame never
        makes a new bitmap, it only moves the ones it has."""
        key = (picture, px, mirror)
        if key not in self._stage_images:
            from PIL import ImageOps, ImageTk
            # picture_image lives in ui, which imports this module; reached
            # through the class's own module, as kg_workbook does.
            image = sys.modules[type(self).__module__].picture_image(picture, px)
            if image is None:
                self._stage_images[key] = None
            else:
                if mirror:
                    image = ImageOps.mirror(image)
                self._stage_images[key] = ImageTk.PhotoImage(image)
        return self._stage_images[key]

    def _stage_lottie(self, key, mirror=False):
        """The PhotoImage frames of `key`'s animation, or None if it has none."""
        cache = ("lottie", key, mirror)
        if cache not in self._stage_images:
            from PIL import Image, ImageOps, ImageTk
            frames = []
            for path in sorted(glob.glob(os.path.join(LOTTIE_CACHE_DIR, key,
                                                      "*.png"))):
                image = Image.open(path)
                frames.append(ImageTk.PhotoImage(
                    ImageOps.mirror(image) if mirror else image))
            self._stage_images[cache] = frames or None
        return self._stage_images[cache]

    def _stage_put(self, picture, x, y, px, mirror=False):
        photo = self._stage_image(picture, px, mirror)
        if photo is None:
            return None
        return self.canvas.create_image(x, y, image=photo, anchor="center",
                                        tags=(self.OVERLAY_TAG, "stage"))

    # ----- building one beat -----
    def _stage_show(self, beat, caption_session):
        """Draw the board for `beat` (-1 = the title) and start its action.

        Called from _draw_kg_story every time the screen is redrawn, which is
        on every new line; anything left over from the line before was
        deleted with the rest of the screen."""
        self._stage_token = getattr(self, "_stage_token", 0) + 1
        cast = getattr(self, "_stage_cast", None)
        plan = getattr(self, "_stage_plan", None)
        if not cast or not plan:
            return
        token = self._stage_token
        if 0 <= beat < len(plan):
            action, actor, other, sky = plan[beat]
        else:
            action, actor, other, sky = ("idle", cast["hero"], None,
                                         plan[0][3] if plan else None)
        if actor:
            self._stage_seen.add(actor)
            # Asleep stays asleep -- the hare snores through the tortoise
            # walking past -- until a line has them do something else.
            asleep = self.__dict__.setdefault("_stage_asleep", set())
            if action == "sleep":
                asleep.add(actor)
            elif action not in ("idle", "mystery"):
                asleep.discard(actor)
        if other and action in ("together", "talk"):
            self._stage_seen.add(other)
        tag = (self.OVERLAY_TAG, "stage")

        # The sky first, so everything else stands in front of it.
        sky_items = self._stage_sky(sky)
        # The ground: a chalk line, and water where the story has a river.
        self.canvas.create_line(STAGE_X0, GROUND_Y + 2, STAGE_X1, GROUND_Y + 2,
                                fill="#C9D8C5", width=2, dash=(10, 4), tags=tag)
        if cast.get("river"):
            self.canvas.create_rectangle(STAGE_X0 + 120, GROUND_Y - 4,
                                         STAGE_X1 - 120, GROUND_Y + 8,
                                         fill="#60A5FA", outline="", tags=tag)
        if cast.get("log"):
            # The one narrow log across it, drawn: the bridge emoji is a
            # city at night, which is not what a goat walks over.
            self.canvas.create_line(STAGE_X0 + 100, GROUND_Y, STAGE_X1 - 100,
                                    GROUND_Y, fill="#92400E", width=9,
                                    capstyle="round", tags=tag)
            for x in (STAGE_X0 + 100, STAGE_X1 - 100):
                self.canvas.create_oval(x - 5, GROUND_Y - 5, x + 5,
                                        GROUND_Y + 5, fill="#B45309",
                                        outline="#78350F", tags=tag)
        for picture, x, y, px in cast["props"]:
            self._stage_put(picture, x, y, px)
        water = None
        if cast.get("water"):
            tx, ty = cast["target"]
            water = self.canvas.create_rectangle(tx - 14, ty + 18, tx + 14,
                                                 ty + 22, fill="#38BDF8",
                                                 outline="", tags=tag)
            level = getattr(self, "_stage_water", 0.0)
            self.canvas.coords(water, tx - 14, ty + 22 - 26 * level, tx + 14,
                               ty + 22)

        actors = {}
        for key, (picture, _home, _w) in cast["actors"].items():
            if key not in self._stage_seen:
                continue
            x = self._stage_x.get(key, _home)
            frames = self._stage_lottie(key)
            if frames:
                # Placed and given its frame by the first tick, just below.
                item = self.canvas.create_image(x, GROUND_Y + 4,
                                                image=frames[0], anchor="s",
                                                tags=tag)
            else:
                item = self._stage_put(picture, x, GROUND_Y - ACTOR_PX / 2,
                                       ACTOR_PX)
            if item is not None:
                actors[key] = (item, picture)
        start = self._stage_beat_start(beat, caption_session)
        state = {"token": token, "action": action, "actor": actor,
                 "other": other, "actors": actors, "start": start,
                 "beat": beat, "session": caption_session, "fx": [],
                 "from": dict(self._stage_x), "sky": sky_items,
                 "water": water, "facing": {}}
        self._stage_setup_fx(state)
        for key in self._stage_asleep:
            if key != actor and key in actors:
                item = self._stage_put("\U0001F4A4", self._stage_x[key] + 20,
                                       GROUND_Y - ACTOR_PX - 4, 20)
                if item is not None:
                    state["fx"].append(("snooze", item, key))
        self._stage_tick(state)

    def _stage_beat_start(self, beat, session):
        """When cue `beat + 1` started on the speaker, or now."""
        start, offsets = _timeline(session)
        cue = beat + 1
        if start and 0 <= cue < len(offsets):
            return start + offsets[cue]
        return time.time()

    def _stage_progress(self, state):
        """0..1 through this beat, by the caption clock: the action fills the
        time the line takes to say, however long that turns out to be."""
        start, offsets = _timeline(state["session"])
        cue = state["beat"] + 1
        now = time.time()
        t0 = state["start"]
        if start and 0 <= cue + 1 < len(offsets):
            t1 = start + offsets[cue + 1]
        else:
            segments = self._kg_story["segments"]
            text = segments[state["beat"]][0] if 0 <= state["beat"] < len(
                segments) else ""
            # Not generated yet: a guess from the length of the line, at the
            # pace she reads a story. Overwritten as soon as the next cue lands.
            t1 = t0 + max(1.6, len(text) / 13.0)
        return max(0.0, min(1.0, (now - t0) / max(0.4, t1 - t0))), now - t0

    # ----- the sky -----
    def _stage_sky(self, sky):
        tag = (self.OVERLAY_TAG, "stage")
        items = []
        if sky == "night":
            self.canvas.create_rectangle(STAGE_X0 - 6, STAGE_Y0 - 4,
                                         STAGE_X1 + 6, GROUND_Y, fill="#0F172A",
                                         outline="", stipple="gray50",
                                         tags=tag)
            self._stage_put("\U0001F319", 566, 150, 30)
            for _ in range(6):
                x = random.randint(STAGE_X0 + 10, STAGE_X1 - 60)
                y = random.randint(STAGE_Y0 + 4, STAGE_Y0 + 50)
                items.append(("twinkle", self.canvas.create_text(
                    x, y, text="✦", fill="#FDE68A", tags=tag,
                    font=("DejaVu Sans", 9)), x, y))
        elif sky == "sun":
            cx, cy = 566, 150
            for n in range(8):
                items.append(("ray", self.canvas.create_line(
                    cx, cy, cx, cy, fill="#FDE68A", width=3, tags=tag), n))
            self._stage_put("☀️", cx, cy, 30)
        elif sky in ("rain", "snow"):
            for _ in range(18):
                x = random.randint(STAGE_X0, STAGE_X1)
                y = random.randint(STAGE_Y0, GROUND_Y)
                if sky == "rain":
                    item = self.canvas.create_line(x, y, x - 3, y + 9,
                                                   fill="#BFDBFE", width=2,
                                                   tags=tag)
                else:
                    item = self.canvas.create_oval(x - 2, y - 2, x + 2, y + 2,
                                                   fill="#FFFFFF", outline="",
                                                   tags=tag)
                items.append((sky, item, x, y))
        return items

    # ----- effects that belong to an action -----
    def _stage_setup_fx(self, state):
        cast = self._stage_cast
        action, actor = state["action"], state["actor"]
        x = self._stage_x.get(actor, 300)
        top = GROUND_Y - ACTOR_PX - 6
        fx = state["fx"]
        pictures = {"sleep": "\U0001F4A4", "happy": "❤️",
                    "sparkle": "✨", "think": "\U0001F4AD",
                    "talk": "\U0001F4AC", "mystery": "❓",
                    "sad": "\U0001F4A7", "shake": "\U0001F4A2"}
        if action in pictures:
            count = 3 if action in ("sleep", "happy", "sparkle", "sad") else 1
            for n in range(count):
                item = self._stage_put(pictures[action], x, top, 22 if count > 1
                                       else 30)
                if item is not None:
                    fx.append((action, item, n))
        if action == "drop" and cast.get("target"):
            item = self._stage_put(cast.get("item", "⚪"), x, top + 20, 20)
            if item is not None:
                fx.append(("drop", item, 0))
        if action in ("fall",) and cast.get("river"):
            fx.append(("splash", None, 0))

    # ----- one frame -----
    def _stage_tick(self, state):
        if (getattr(self, "_stage_token", None) != state["token"]
                or self.overlay != "kg_story"
                # The question screen is drawn without a stage: nothing left
                # to move, so stop rather than tick on at 20 fps until the
                # child leaves the screen.
                or not self.canvas.find_withtag("stage")):
            return
        p, elapsed = self._stage_progress(state)
        cast = self._stage_cast
        action = state["action"]
        for key, (item, picture) in state["actors"].items():
            x0 = state["from"].get(key, self._stage_x.get(key))
            x, dy, facing = self._stage_motion(key, action, state, x0, p,
                                               elapsed)
            self._stage_x[key] = x
            if self._stage_lottie(key):
                if facing:
                    self._stage_facing[key] = facing
                drawn = LOTTIE_FACES.get(key)
                frames = self._stage_lottie(
                    key, bool(drawn) and self._stage_facing.get(key, drawn) != drawn)
                if (key == state["actor"] and action in MOVING
                        and key not in self._stage_asleep):
                    self._stage_step[key] = self._stage_step.get(key, 0) + (
                        1.7 if action == "run" else 1)
                step = int(self._stage_step.get(key, 0)) % len(frames)
                self.canvas.coords(item, x, GROUND_Y + 4 + dy)
                self.canvas.itemconfigure(item, image=frames[step])
                continue
            y = GROUND_Y - ACTOR_PX / 2 + dy
            self.canvas.coords(item, x, y)
            if picture in SIDE_ON and facing and facing != state[
                    "facing"].get(key, "left"):
                photo = self._stage_image(picture, ACTOR_PX,
                                          mirror=facing == "right")
                if photo is not None:
                    self.canvas.itemconfigure(item, image=photo)
                state["facing"][key] = facing
        self._stage_fx_frame(state, p, elapsed)
        self._stage_sky_frame(state, elapsed)
        if cast.get("water") and state["water"] is not None:
            tx, ty = cast["target"]
            if action in ("drop", "rise"):
                # Every stone raises the water a little, and "higher and
                # higher" raises it a lot -- by the time he drinks, it is up.
                target = min(1.0, getattr(self, "_stage_water_base", 0.15)
                             + (0.12 if action == "drop" else 0.4) * p)
                self._stage_water = max(getattr(self, "_stage_water", 0.15),
                                        target)
            level = getattr(self, "_stage_water", 0.15)
            self.canvas.coords(state["water"], tx - 14, ty + 22 - 26 * level,
                               tx + 14, ty + 22)
        if p >= 1.0:
            self._stage_water_base = getattr(self, "_stage_water", 0.15)
        self.root.after(FRAME_MS, lambda: self._stage_tick(state))

    def _stage_motion(self, key, action, state, x0, p, t):
        """(x, dy, facing) for one actor this frame. The actor the line is
        about does the action; everyone else breathes, so the board is never
        a still picture while she is talking."""
        cast = self._stage_cast
        home = cast["actors"][key][1]
        breathe = 2 * math.sin(t * 2.4 + home)
        if key != state["actor"]:
            if key in self._stage_asleep:
                return x0, 8 + 2 * math.sin(t * 1.5), None
            if action == "together" and key == state["other"]:
                meet = (x0 + self._stage_x.get(state["actor"], x0)) / 2
                return x0 + (meet + 34 - x0) * min(1, p * 1.6), breathe, None
            if action == "fall" and key == state["other"] and cast.get("river"):
                return self._stage_fall(x0, p)
            return x0, breathe, None
        ease = 0.5 - 0.5 * math.cos(math.pi * min(1.0, p * 1.4))
        if action in ("walk", "run"):
            # Walk away from the side they are nearest, so a story's worth of
            # walking does not march everyone off the edge of the board.
            far = STAGE_X1 - 40 if x0 < (STAGE_X0 + STAGE_X1) / 2 else STAGE_X0 + 40
            if cast.get("finish") and action == "run" and key == "hare":
                far = min(far, cast["finish"] - 70)
            if cast.get("finish") and action == "walk" and key == "tortoise":
                far = min(STAGE_X1 - 40, x0 + 70)
            span = far - x0
            if action == "walk":
                span = max(-110, min(110, span))
            x = x0 + span * ease
            hop = abs(math.sin(t * (14 if action == "run" else 7))) * (
                9 if action == "run" else 4)
            return x, -hop, "right" if span > 0 else "left"
        if action == "fly":
            far = STAGE_X1 - 50 if x0 < (STAGE_X0 + STAGE_X1) / 2 else STAGE_X0 + 50
            x = x0 + (far - x0) * ease
            lift = math.sin(math.pi * ease) * 80 + abs(math.sin(t * 12)) * 5
            return x, -lift, "right" if far > x0 else "left"
        if action in ("hop", "happy"):
            return x0, -abs(math.sin(t * 7)) * 14, None
        if action == "shake":
            return x0 + 5 * math.sin(t * 40), 0, None
        if action == "sad":
            return x0, 6 + breathe / 2, None
        if action == "sleep":
            return x0, 8 + 2 * math.sin(t * 1.5), None
        if action in ("drink", "eat"):
            tx = cast.get("target", (x0 + 60, 0))[0]
            stand = tx - 44 if x0 < tx else tx + 44
            x = x0 + (stand - x0) * min(1, p * 2.5)
            dip = max(0, math.sin(t * 9)) * 10 if p > 0.35 else 0
            return x, dip, "right" if tx > x else "left"
        if action == "drop":
            tx = cast.get("target", (x0 + 60, 0))[0]
            stand = tx - 50 if x0 < tx else tx + 50
            x = x0 + (stand - x0) * min(1, p * 3)
            return x, -abs(math.sin(t * 5)) * 4, "right" if tx > x else "left"
        if action == "fall":
            return self._stage_fall(x0, p)
        if action == "together":
            other = state["other"]
            meet = (x0 + self._stage_x.get(other, x0)) / 2 if other else x0
            return x0 + (meet - 34 - x0) * min(1, p * 1.6), breathe, None
        if action == "look":
            return x0 + 8 * math.sin(t * 3), breathe, None
        if action == "rise":
            return x0, -abs(math.sin(t * 4)) * 6, None
        return x0, breathe, None

    def _stage_fall(self, x0, p):
        """Over the edge and down into the water."""
        drop = 0 if p < 0.3 else min(1.0, (p - 0.3) / 0.4)
        return x0, drop * drop * 40, None

    def _stage_fx_frame(self, state, p, t):
        cast = self._stage_cast
        x = self._stage_x.get(state["actor"], 300)
        top = GROUND_Y - ACTOR_PX - 10
        for kind, item, n in state["fx"]:
            if item is None:
                if kind == "splash" and 0.65 < p < 0.95:
                    self._stage_splash(state, x)
                continue
            if kind == "snooze":
                phase = (t * 0.5) % 1.0
                sx = self._stage_x.get(n, x)
                self.canvas.coords(item, sx + 16 + 6 * math.sin(phase * 6),
                                   top - phase * 30)
                continue
            if kind in ("sleep", "happy", "sparkle", "sad"):
                phase = (t * 0.6 + n / 3.0) % 1.0
                if kind == "sad":
                    # Tears fall beside the face; everything else floats up.
                    self.canvas.coords(item, x - 22 + n * 22,
                                       top + 20 + phase * 34)
                elif kind == "sparkle":
                    self.canvas.coords(item, x + 30 * math.cos(n * 2.1 + t * 2),
                                       top + 6 + 18 * math.sin(n * 2.1 + t * 2))
                else:
                    self.canvas.coords(item, x + 14 + 10 * math.sin(phase * 6
                                                                   + n),
                                       top - phase * 50)
            elif kind in ("think", "talk", "mystery", "shake"):
                bob = 3 * math.sin(t * 4)
                self.canvas.coords(item, x + 26, top - 12 + bob)
            elif kind == "drop":
                tx, ty = cast["target"]
                q = max(0.0, min(1.0, (p - 0.3) / 0.5))
                sx, sy = x + 20, top + 24
                cx = sx + (tx - sx) * q
                cy = sy + (ty - 10 - sy) * q - math.sin(math.pi * q) * 40
                if q >= 1.0:
                    self.canvas.coords(item, -100, -100)
                    if not state.get("splashed"):
                        state["splashed"] = True
                        self._stage_splash(state, tx, ty - 14)
                else:
                    self.canvas.coords(item, cx, cy)

    def _stage_splash(self, state, x, y=None):
        """Three drops jumping out of the water, once."""
        if state.get("splash_done"):
            return
        state["splash_done"] = True
        y = y if y is not None else GROUND_Y
        tag = (self.OVERLAY_TAG, "stage")
        drops = [self.canvas.create_oval(x - 3, y - 3, x + 3, y + 3,
                                         fill="#7DD3FC", outline="", tags=tag)
                 for _ in range(4)]
        token = state["token"]

        def fly(n=0):
            if getattr(self, "_stage_token", None) != token or n > 10:
                for d in drops:
                    self.canvas.delete(d)
                return
            for i, d in enumerate(drops):
                dx = (i - 1.5) * 6 * n / 3
                dy = -14 * n + 2.2 * n * n
                self.canvas.coords(d, x + dx - 3, y + dy - 3, x + dx + 3,
                                   y + dy + 3)
            self.root.after(40, lambda: fly(n + 1))
        fly()

    def _stage_sky_frame(self, state, t):
        for entry in state["sky"]:
            kind, item = entry[0], entry[1]
            if kind == "ray":
                n = entry[2]
                a = n * math.pi / 4 + t * 0.6
                r0, r1 = 20, 26 + 3 * math.sin(t * 3 + n)
                self.canvas.coords(item, 566 + r0 * math.cos(a),
                                   150 + r0 * math.sin(a),
                                   566 + r1 * math.cos(a),
                                   150 + r1 * math.sin(a))
            elif kind == "twinkle":
                self.canvas.itemconfigure(
                    item, fill="#FDE68A" if math.sin(t * 3 + entry[2]) > 0
                    else "#64748B")
            elif kind in ("rain", "snow"):
                _k, _i, x, y = entry
                speed = 160 if kind == "rain" else 30
                yy = STAGE_Y0 + (y - STAGE_Y0 + t * speed) % (GROUND_Y - STAGE_Y0)
                xx = x + (math.sin(t + x) * 6 if kind == "snow" else 0)
                if kind == "rain":
                    self.canvas.coords(item, xx, yy, xx - 3, yy + 9)
                else:
                    self.canvas.coords(item, xx - 2, yy - 2, xx + 2, yy + 2)


if __name__ == "__main__":
    build_lottie_frames()
