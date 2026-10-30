#!/usr/bin/env python3
"""Synthetic Google Form response exports, the corpus the CSV proposal and start are measured on.

Why this exists: three MVP blockers found on 2026-09-14 came from the *shape* of a real export, not
from logic, and every CSV test in this suite used short single-line stems like
``"Which days can you attend?"``. A fixture invented by the people who wrote the parser only tests
what they already thought of, so each form here keeps the shapes a Google Form really produces:
multi-line grid headers, unpadded timestamps, duplicate and organizer columns, uploads, rare
options, refused rows and a few hundred rows.

Why it is synthetic: a real export names real people, and its question text names the real
organization, its market and its clubs. Nothing here comes from one. Every header is written for
this file, every person is drawn from the pools of common names below, every address and link is at
a fixture domain (an upload keeps the Google Drive host, with an invented file id, because the
proposal knows an upload by that host), and every other answer is made from the word lists here.

Each form is described declaratively: its header row, and one cell kind per column with the
counts it must produce. Generation is seeded per form, so the output is the same bytes every time,
and ``tests/test_synthetic_form_exports.py`` fails when a committed file is not exactly what this
module makes. Change a fixture by changing its description here, never by editing the file.

Usage, from ``back-end/``:
    python tests/fixtures/synthetic_form_exports.py
"""
import csv
import io
import os
import random
import string
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

CORPUS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "test_data", "google_forms")

# ── The fictional vocabulary ────────────────────────────────────────────────────────────────────

GIVEN_NAMES = (
    "Aaron", "Abby", "Adam", "Adrian", "Aiden", "Aisha", "Alan", "Alex", "Alice", "Alicia",
    "Amanda", "Amara", "Amelia", "Amir", "Amy", "Ana", "Andre", "Andrew", "Angela", "Anita",
    "Ann", "Anna", "Anthony", "Arjun", "Ava", "Ben", "Bianca", "Brandon", "Brian", "Bruno",
    "Caleb", "Camila", "Carla", "Carlos", "Carmen", "Caroline", "Catherine", "Cecilia", "Charles",
    "Charlotte", "Chen", "Chloe", "Chris", "Claire", "Clara", "Colin", "Connor", "Daisy", "Daniel",
    "Daniela", "David", "Deepa", "Diana", "Diego", "Dylan", "Eden", "Elena", "Eli", "Elijah",
    "Eliza", "Ella", "Ellen", "Emily", "Emma", "Eric", "Erin", "Ethan", "Eva", "Evan", "Faith",
    "Farah", "Felix", "Fiona", "Frank", "Gabriel", "Gemma", "George", "Grace", "Hana", "Hannah",
    "Harper", "Harry", "Hassan", "Hazel", "Helen", "Henry", "Holly", "Hugo", "Ian", "Imani",
    "Iris", "Isaac", "Isabel", "Ivy", "Jack", "Jacob", "Jade", "James", "Jamie", "Jane", "Jasmine",
    "Jason", "Javier", "Jay", "Jenna", "Jesse", "Jin", "Joan", "Joel", "John", "Jonah", "Jordan",
    "Jose", "Joseph", "Joy", "Julia", "Julian", "June", "Kai", "Karen", "Kate", "Kevin", "Kim",
    "Kira", "Kyle", "Lara", "Laura", "Layla", "Leah", "Leo", "Liam", "Lily", "Lina", "Linda",
    "Lisa", "Logan", "Lucas", "Lucy", "Luis", "Luke", "Luna", "Maya", "Mark", "Marta", "Mary",
    "Mason", "Matt", "Max", "Megan", "Mei", "Mia", "Michael", "Mila", "Miles", "Mina", "Miriam",
    "Mohamed", "Mona", "Nadia", "Naomi", "Nathan", "Neha", "Nick", "Nina", "Noah", "Nora", "Olive",
    "Oliver", "Olivia", "Omar", "Oscar", "Owen", "Paige", "Paul", "Pedro", "Peter", "Petra",
    "Philip", "Priya", "Quinn", "Rachel", "Rafael", "Rahul", "Ravi", "Rebecca", "Reza", "Rhea",
    "Riley", "Rita", "Robert", "Robin", "Rosa", "Rose", "Ruby", "Ryan", "Sam", "Samir", "Sana",
    "Sara", "Sarah", "Sean", "Selena", "Seth", "Simon", "Sofia", "Sophie", "Stella", "Steven",
    "Sunny", "Tara", "Teresa", "Theo", "Thomas", "Tina", "Tom", "Tony", "Uma", "Vera", "Victor",
    "Vivian", "Wei", "Wendy", "Will", "Xavier", "Yara", "Yusuf", "Zach", "Zara", "Zoe", "Aria",
    "Beatriz", "Cyrus", "Dara", "Elif", "Freya", "Goran", "Ines", "Kenji", "Lars", "Marco",
)

# Drawn on as well only by a form too large for the names above, so a smaller form's applicants
# stay who they were.
MORE_GIVEN_NAMES = (
    "Abel", "Ada", "Agnes", "Alba", "Alma", "Ari", "Asha", "Aubrey", "Axel", "Bea", "Bella",
    "Blake", "Bo", "Brody", "Cara", "Cole", "Dana", "Dante", "Dean", "Derek", "Dina", "Drew",
    "Edgar", "Edith", "Elsa", "Emil", "Enzo", "Esme", "Ezra", "Flora", "Gia", "Gina", "Greta",
    "Gus", "Hector", "Heidi", "Ida", "Ingrid", "Ivan", "Jada", "Jules", "Kara", "Kian", "Kofi",
    "Leila", "Leon", "Lena", "Lia", "Lionel", "Lola", "Lorenzo", "Mabel", "Malik", "Mara",
    "Maria", "Mateo", "Milo", "Mira", "Nell", "Nico", "Nils", "Noor", "Ola", "Orla", "Otto",
    "Pablo", "Pia", "Rami", "Remy", "Rex", "Rina", "Rory", "Rumi", "Ruth", "Sadie", "Saul",
    "Silas", "Suki", "Tessa", "Tobias", "Uri", "Vic", "Wade", "Willa", "Yuki", "Zane", "Zuri",
    "Anya", "Bram", "Cleo", "Dev", "Elio", "Fern", "Hal", "Isla", "Juno", "Kit", "Lev", "Mae",
    "Nate", "Odin", "Pip", "Rafa", "Sol", "Tam", "Ugo", "Val", "Wren", "Yan", "Zeke",
)

FAMILY_NAMES = (
    "Adams", "Ahmed", "Ali", "Allen", "Alvarez", "Anderson", "Bailey", "Baker", "Bell", "Bennett",
    "Brooks", "Brown", "Campbell", "Carter", "Castro", "Chan", "Chang", "Chen", "Clark", "Collins",
    "Cook", "Cooper", "Cruz", "Das", "Davis", "Diaz", "Edwards", "Evans", "Fischer", "Flores",
    "Foster", "Garcia", "Gomez", "Gonzalez", "Gray", "Green", "Gupta", "Hall", "Harris", "Hayes",
    "Hernandez", "Hill", "Ho", "Hughes", "Hussain", "Jackson", "James", "Jensen", "Johnson",
    "Jones", "Kaur", "Kelly", "Khan", "Kim", "King", "Kumar", "Lam", "Lee", "Lewis", "Li", "Lin",
    "Liu", "Lopez", "Martin", "Martinez", "Mehta", "Miller", "Mitchell", "Moore", "Morales",
    "Morgan", "Murphy", "Nelson", "Ng", "Nguyen", "Novak", "Park", "Patel", "Perez", "Phillips",
    "Price", "Ramirez", "Reed", "Reyes", "Rivera", "Roberts", "Robinson", "Rodriguez", "Rossi",
    "Ruiz", "Russell", "Sanchez", "Santos", "Scott", "Shah", "Silva", "Singh", "Smith", "Stewart",
    "Sullivan", "Tan", "Taylor", "Thomas", "Thompson", "Torres", "Tran", "Turner", "Walker",
    "Wang", "Ward", "Watson", "White", "Williams", "Wilson", "Wong", "Wood", "Wright", "Wu",
    "Yang", "Young", "Zhang", "Zhou",
)

# A business is a craft word and a shop word.
CRAFT_WORDS = (
    "Acorn", "Amber", "Bramble", "Button", "Cedar", "Clay", "Clover", "Cobalt", "Copper", "Daisy",
    "Ember", "Fern", "Fig", "Finch", "Glaze", "Hazel", "Honey", "Indigo", "Inkwell", "Ivy",
    "Juniper", "Kiln", "Lantern", "Linen", "Maple", "Marigold", "Meadow", "Moss", "Nettle",
    "Oak", "Paper", "Pebble", "Pine", "Plum", "Quill", "Saffron", "Sage", "Spool", "Sprout",
    "Thistle", "Thread", "Tidal", "Willow", "Wren", "Yarrow",
)
SHOP_WORDS = (
    "Studio", "Works", "Goods", "Press", "Makery", "Atelier", "Workshop", "Crafts", "Supply",
    "Collective", "Corner", "House", "Lab", "Market", "Co",
)

# Words for the "Other" answers applicants type into a checkbox question.
OTHER_MAKES = (
    "bookmarks", "candles", "coasters", "earrings", "enamel pins", "fridge magnets",
    "greeting cards", "hair clips", "journals", "lanyards", "mugs", "notebooks", "patches", "phone charms",
    "plushies", "postcards", "pouches", "rings", "scarves", "soaps", "tote bags", "zines",
)
OTHER_STYLES = (
    "Beaded", "Embroidered", "Felted", "Hand-bound", "Hand-painted", "Laser-cut", "Lino-printed",
    "Macrame", "Polymer clay", "Pressed-flower", "Quilted", "Resin", "Riso-printed", "Upcycled",
    "Watercolour", "Woodburned",
)

# Sentences prose answers are put together from.
TABLING_SENTENCES = (
    "I tabled at two campus fairs last year.",
    "This would be my first market.",
    "I sold prints at a local zine fest.",
    "I have shared a table with a friend before.",
    "I run a small online shop but have not tabled yet.",
    "I helped at a friend's table last spring.",
    "I have done three craft markets downtown.",
    "I sold at my high school's winter fair.",
    "I table at a weekend flea market most months.",
    "I was at the last two fairs.",
    "I have done a few artist alleys at conventions.",
    "I sold stickers at a club booth once.",
    "Not yet, but I am excited to try.",
    "I volunteered at a market but have never sold.",
    "I set up a pop-up stall at a community event.",
)
COMMENT_SENTENCES = (
    "Thank you for organizing this!",
    "Could I be near a power outlet?",
    "I may arrive a little late on the first day.",
    "I would love to be near the entrance if possible.",
    "I use a small display rack, about a metre tall.",
    "Looking forward to it!",
    "I can only stay until mid-afternoon on Friday.",
    "Please let me know if you need anything else.",
    "I applied last time too.",
    "My partner will help me set up.",
    "I am happy to share a table with anyone.",
    "I will bring my own tablecloth.",
    "Is there storage overnight?",
    "Can I bring a card reader?",
    "This is my first time applying.",
    "Excited to meet other makers!",
    "I might bring a small lamp for my display.",
    "Hope to see you there.",
)
NOTE_SENTENCES = (
    "Asked to be placed near the entrance.",
    "Portfolio checked.",
    "Proof of membership is a screenshot, fine.",
    "Applied last fair too.",
    "Needs a table near an outlet.",
    "Shares a table with a friend.",
    "Check the portfolio link again.",
    "Timetable uploaded instead of a card.",
    "Asked about storage overnight.",
    "Arrives late on the first day.",
    "Second application from the same shop.",
    "Wants the same spot as last time.",
    "Emailed to ask about card readers.",
)
RING_SIZES = (
    "Sizes 5 to 9", "Mostly 6, 7 and 8", "Adjustable bands only", "US 4 to 10",
    "Small, medium and large", "Size 7 only", "Half sizes from 5 to 8", "A few of each, 6 to 9",
    "Made to order", "Whatever fits on the day",
)


# ── Cell kinds ──────────────────────────────────────────────────────────────────────────────────


@dataclass
class Person:
    given: str
    family: str
    email: str
    handle: str


class Context:
    """What a cell kind may read while its column is made: the seeded generator, the applicants,
    the columns made before it, and the rows whose cell in this column the form writes itself
    (``closed``), which a kind's counts leave out."""

    def __init__(self, rng: random.Random, people: List[Person]):
        self.rng = rng
        self.people = people
        self.columns: List[List[str]] = []
        self.closed: frozenset = frozenset()

    @property
    def rows(self) -> int:
        return len(self.people)

    @property
    def open_rows(self) -> List[int]:
        return [row for row in range(self.rows) if row not in self.closed]

    def place(self, counts: Dict[str, int], rows: Optional[Sequence[int]] = None) -> List[str]:
        """Each value in exactly as many rows as its count, at random among ``rows`` (the open
        ones unless given), blank in the rest."""
        rows = self.open_rows if rows is None else list(rows)
        values = [value for value, count in counts.items() for _ in range(count)]
        if len(values) > len(rows):
            raise ValueError(f"{len(values)} answers for {len(rows)} rows")
        cells = [""] * self.rows
        for row, value in zip(self.rng.sample(rows, len(values)), values):
            cells[row] = value
        return cells


class Kind:
    def cells(self, context: Context) -> List[str]:
        raise NotImplementedError


@dataclass
class Constant(Kind):
    """Everyone's answer is the same text: a ticked certification box exports as its own text.
    Blank in ``blank_rows``."""
    value: str
    blank_rows: Tuple[int, ...] = ()

    def cells(self, context):
        return ["" if row in self.blank_rows else self.value for row in range(context.rows)]


@dataclass
class Choice(Kind):
    """A single choice, or an organizer's status: each answer in exactly as many rows as its
    count, blank in the rest."""
    counts: Dict[str, int]

    def cells(self, context):
        return context.place(self.counts)


@dataclass
class GridDay(Choice):
    """One day of a tier grid, a Choice whose "None" is never a row's answer on every day: nobody
    applies to a market they cannot come to. A row "None" on all the ``earlier`` days is given one
    of this day's tiers, but for the first ``unavailable`` of them, who answered "None" every day
    all the same, and whom the import refuses."""
    earlier: Tuple[int, ...] = ()
    unavailable: int = 0

    def cells(self, context):
        absent = [row for row in context.open_rows if self.earlier
                  and all(context.columns[day][row] == "None" for day in self.earlier)]
        tiers = [value for value, count in self.counts.items() if value != "None"
                 for _ in range(count)]
        context.rng.shuffle(tiers)
        given = dict(zip(absent[self.unavailable:], tiers))
        given.update({row: "None" for row in absent[:self.unavailable]})
        left = dict(self.counts)
        for value in given.values():
            left[value] -= 1
        cells = context.place(left, [row for row in context.open_rows if row not in given])
        for row, value in given.items():
            cells[row] = value
        return cells


@dataclass
class Timestamp(Kind):
    """When each row was submitted, in the sheet's ``M/D/YYYY H:MM:SS`` with nothing padded, in
    submission order."""
    start: datetime
    end: datetime

    def cells(self, context):
        span = int((self.end - self.start).total_seconds())
        moments = sorted(self.start + timedelta(seconds=s)
                         for s in context.rng.sample(range(span), context.rows))
        return [f"{m.month}/{m.day}/{m.year} {m.hour}:{m.minute:02d}:{m.second:02d}"
                for m in moments]


@dataclass
class Email(Kind):
    """Each applicant's own address; but in ``pasted`` rows the answer is a copy of that row's
    cell in ``from_column``, in ``name_only`` rows the applicant's given name, and in ``named``
    rows their name written before their address: answers that are not an address."""
    pasted: Tuple[int, ...] = ()
    from_column: int = 1
    name_only: Tuple[int, ...] = ()
    named: Tuple[int, ...] = ()

    def cells(self, context):
        def answer(row, person):
            if row in self.pasted:
                return context.columns[self.from_column][row]
            if row in self.name_only:
                return person.given.lower()
            if row in self.named:
                return f"{person.given} {person.family} - {person.email}"
            return person.email
        return [answer(row, person) for row, person in enumerate(context.people)]


@dataclass
class Duplicate(Kind):
    """A second column asking the same thing: a copy of ``of``, but for ``differs`` rows, where
    the applicant gave another address of theirs. A row whose ``of`` is not an address is always
    one of them."""
    of: int
    differs: int = 0

    def cells(self, context):
        cells = list(context.columns[self.of])
        wrong = [row for row in context.open_rows if "@" not in cells[row]]
        right = [row for row in context.open_rows if row not in wrong]
        for row in wrong + context.rng.sample(right, self.differs - len(wrong)):
            person = context.people[row]
            cells[row] = f"{person.given}{person.family}{row}@example.org".lower()
        return cells


@dataclass
class FullName(Kind):
    """Given and family name, blank in ``blank_rows``."""
    blank_rows: Tuple[int, ...] = ()

    def cells(self, context):
        return ["" if row in self.blank_rows else f"{person.given} {person.family}"
                for row, person in enumerate(context.people)]


@dataclass
class PreferredName(Kind):
    """The name an applicant goes by: their given name. Left blank by ``blank`` applicants, where
    the form did not require it."""
    blank: int = 0

    def cells(self, context):
        left = set(context.rng.sample(context.open_rows, self.blank)) if self.blank else set()
        return ["" if row in left else person.given
                for row, person in enumerate(context.people)]


@dataclass
class SchoolEmail(Kind):
    """An address at the college, for ``count`` applicants."""
    count: int

    def cells(self, context):
        rows = set(context.rng.sample(context.open_rows, self.count))
        return [f"{p.given}.{p.family}{row}@students.example.com".lower() if row in rows else ""
                for row, p in enumerate(context.people)]


@dataclass
class Handle(Kind):
    """A chat or social handle, one per applicant."""

    def cells(self, context):
        return [person.handle for person in context.people]


@dataclass
class Business(Kind):
    """A craft word and a shop word; ``repeats`` applicants share a name already taken."""
    repeats: int = 0

    def cells(self, context):
        names = context.rng.sample([f"{craft} {shop}" for craft in CRAFT_WORDS
                                    for shop in SHOP_WORDS], context.rows - self.repeats)
        names += context.rng.sample(names, self.repeats)
        context.rng.shuffle(names)
        return names


@dataclass
class Link(Kind):
    """A link at example.com naming the applicant's handle, for ``count`` applicants; plus the
    short answers in ``shared`` instead of a link, each given by exactly as many as its count."""
    path: str
    count: int
    shared: Dict[str, int] = field(default_factory=dict)

    def cells(self, context):
        return _accounts(context, self.count, self.shared,
                         lambda person: f"https://example.com/{self.path}/{person.handle}")


@dataclass
class Social(Kind):
    """A social account for ``count`` applicants, written as applicants write one: a handle with
    its @, a bare handle, or a link at example.com; plus the short answers in ``shared``, as
    ``Link`` has them."""
    path: str
    count: int
    shared: Dict[str, int] = field(default_factory=dict)

    def cells(self, context):
        def written(person):
            return context.rng.choice((f"@{person.handle}", person.handle,
                                       f"https://example.com/{self.path}/{person.handle}"))
        return _accounts(context, self.count, self.shared, written)


def _accounts(context, count, shared, written) -> List[str]:
    """``written(person)`` for ``count`` applicants, then each of the ``shared`` answers in exactly
    as many of the rows left as its count."""
    rows = set(context.rng.sample(context.open_rows, count))
    cells = [written(p) if row in rows else "" for row, p in enumerate(context.people)]
    if shared:
        words = context.place(shared, [row for row in context.open_rows if row not in rows])
        cells = [cell or word for cell, word in zip(cells, words)]
    return cells


@dataclass
class Upload(Kind):
    """A Google Forms file upload, which exports as a Drive link: the proposal knows an upload by
    that host, so it is kept, with an invented file id."""
    count: int

    def cells(self, context):
        rows = set(context.rng.sample(context.open_rows, self.count))
        alphabet = string.ascii_letters + string.digits + "-_"
        return ["https://drive.google.com/open?id="
                + "".join(context.rng.choice(alphabet) for _ in range(33)) if row in rows else ""
                for row in range(context.rows)]


@dataclass
class Prose(Kind):
    """Free text from ``sentences``, one to ``most`` of them, for ``count`` applicants; plus the
    short answers in ``shared``, each given by exactly as many applicants as its count."""
    sentences: Tuple[str, ...]
    count: int
    most: int = 2
    shared: Dict[str, int] = field(default_factory=dict)

    def cells(self, context):
        answers = []
        while len(answers) < self.count - sum(self.shared.values()):
            answer = " ".join(context.rng.sample(self.sentences,
                                                 context.rng.randint(1, self.most)))
            if answer not in answers:
                answers.append(answer)
        return context.place({**{answer: 1 for answer in answers}, **self.shared})


@dataclass
class MultiSelect(Kind):
    """A checkbox question: each option chosen by exactly as many applicants as its count, written
    in the form's order and joined by ", " as Google joins them; then the "Other" answers
    applicants typed, ``rare`` of them chosen once, twice and so on. ``only_rare`` applicants gave
    nothing but such an answer."""
    options: Dict[str, int]
    rare: Tuple[int, ...]
    only_rare: int

    def cells(self, context):
        rng = context.rng
        rows = context.open_rows
        alone = set(rng.sample(rows, self.only_rare))
        others = [row for row in rows if row not in alone]
        chosen: Dict[int, set] = {row: set() for row in rows}
        # Everyone else chooses at least one option, drawn in proportion to the counts.
        pool = [option for option, count in self.options.items() for _ in range(count)]
        rng.shuffle(pool)
        for row, option in zip(others, pool):
            chosen[row].add(option)
        for option, count in self.options.items():
            missing = count - sum(1 for row in others if option in chosen[row])
            free = [row for row in others if option not in chosen[row]]
            for row in rng.sample(free, missing):
                chosen[row].add(option)
        typed = self._typed(rng, len(self.rare))
        extra: Dict[int, List[str]] = {row: [] for row in rows}
        alone_left = sorted(alone)
        for answer, count in zip(typed, self.rare):
            # The applicants with nothing else are given a typed answer first.
            takers = alone_left[:count]
            alone_left = alone_left[count:]
            free = [row for row in rows if row not in takers and row not in alone_left]
            takers += rng.sample(free, count - len(takers))
            for row in takers:
                extra[row].append(answer)
        if alone_left:
            raise ValueError("fewer typed answers than applicants who gave only those")
        order = list(self.options)
        return [", ".join([o for o in order if o in chosen[row]] + extra[row])
                if row in chosen else "" for row in range(context.rows)]

    @staticmethod
    def _typed(rng, count):
        return rng.sample([f"{style} {make}" for style in OTHER_STYLES for make in OTHER_MAKES],
                          count)


@dataclass
class TableShare(Kind):
    """Who an applicant wants to share a half table with: ``applicants`` name another applicant's
    address, ``outsiders`` an address nobody applied from, ``pairs`` two applicants' addresses,
    and the rest of ``words`` their own words, each as many times as its count."""
    applicants: int
    outsiders: int
    pairs: int
    words: Dict[str, int]

    def cells(self, context):
        rng = context.rng
        emails = [person.email for person in context.people]
        answers: Dict[str, int] = dict(self.words)
        rows = list(range(context.rows))
        for row in rng.sample(rows, self.applicants):
            answers[emails[row]] = answers.get(emails[row], 0) + 1
        for n in range(self.outsiders):
            answers[f"partner{n + 1}@example.com"] = 1
        for _ in range(self.pairs):
            first, second = rng.sample(emails, 2)
            answers[f"{first}, {second}"] = 1
        cells = context.place(answers)
        # Nobody names themself.
        rows = context.open_rows
        for at, row in enumerate(rows):
            if cells[row] == emails[row]:
                other = rows[(at + 1) % len(rows)]
                cells[row], cells[other] = cells[other], cells[row]
        return cells


@dataclass
class Blank(Kind):
    """A column with no answers: the empty columns a sheet carries after the form's last."""

    def cells(self, context):
        return [""] * context.rows


@dataclass
class Note(Kind):
    """An organizer's note in a column they added, on ``count`` rows."""
    count: int

    def cells(self, context):
        return context.place({sentence: 1 for sentence in NOTE_SENTENCES[:self.count]})


# ── The forms ───────────────────────────────────────────────────────────────────────────────────


@dataclass
class Form:
    """A form's export. Three kinds of row are the form's own rather than a column's: the
    ``stopped`` applicants, who sent the form with every question from column ``stopped_at`` on
    left blank; with ``test_from``, a last row the organizer sent to try the form, "TEST" in
    every column from that one; and the ``typed`` rows, where the organizer filled in the first
    column and nobody answered the form. Each pair in ``repeats`` is one applicant sending the
    form twice: the second row is the first row's person, with answers of its own, and with
    another name in a ``renamed`` row. The ``empty`` rows are the blank lines a sheet keeps,
    with nothing in any column."""
    file: str
    seed: int
    rows: int
    columns: Sequence[Tuple[str, Kind]]
    stopped: Tuple[int, ...] = ()
    stopped_at: int = 0
    test_from: Optional[int] = None
    typed: Tuple[int, ...] = ()
    repeats: Tuple[Tuple[int, int], ...] = ()
    renamed: Tuple[int, ...] = ()
    empty: Tuple[int, ...] = ()

    def people(self, rng: random.Random) -> List[Person]:
        """Distinct applicants: a few share a given name, as people do."""
        shared = max(self.rows // 20, 1)
        pool = GIVEN_NAMES if self.rows - shared <= len(GIVEN_NAMES) \
            else GIVEN_NAMES + MORE_GIVEN_NAMES
        given = rng.sample(pool, self.rows - shared)
        given += rng.sample(given, shared)
        rng.shuffle(given)
        family = [rng.choice(FAMILY_NAMES) for _ in range(self.rows)]
        people = []
        for row, (first, last) in enumerate(zip(given, family)):
            handle = f"example{first}{last}{row}".lower()
            people.append(Person(first, last, f"{first}.{last}{row}@example.com".lower(), handle))
        for first, again in self.repeats:
            people[again] = people[first]
        for row in self.renamed:
            person = people[row]
            people[row] = Person(rng.choice(GIVEN_NAMES), rng.choice(FAMILY_NAMES), person.email,
                                 person.handle)
        return people

    def rows_of_cells(self) -> List[List[str]]:
        rng = random.Random(self.seed)
        context = Context(rng, self.people(rng))
        test_row = self.rows - 1
        for index, (_header, kind) in enumerate(self.columns):
            stopped = set(self.stopped) if self.stopped and index >= self.stopped_at else set()
            tested = {test_row} if self.test_from is not None and index >= self.test_from else set()
            typed = set(self.typed) if index >= 1 else set()
            empty = set(self.empty)
            context.closed = frozenset(stopped | tested | typed | empty)
            cells = kind.cells(context)
            for row in stopped | typed | empty:
                cells[row] = ""
            for row in tested:
                cells[row] = "TEST"
            context.columns.append(cells)
        return [list(row) for row in zip(*context.columns)]

    def text(self) -> str:
        """The file as Google Sheets exports it: CRLF between records, LF inside a cell."""
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow([header for header, _ in self.columns])
        writer.writerows(self.rows_of_cells())
        return out.getvalue()

    def bytes(self) -> bytes:
        """UTF-8 without a byte order mark."""
        return self.text().encode("utf-8")


DAY_GRID = (
    "For each market day, tick every table tier you would accept. Leave a day at None if you "
    "cannot come that day.\n"
    "\n"
    "NOTE: \n"
    "- Gold tables are by the main doors, Silver tables line the middle aisle and Bronze tables "
    "are along the back wall; each tier costs less than the one before.\n"
    "- Ticking more tiers makes it more likely we can find you a table.\n"
    "- We will never place you on a day you left at None, or at a tier you did not tick. [{}]"
)

FIVE_DAY_GRID = Form(
    file="five-day-grid.csv",
    seed=5,
    rows=237,
    columns=[
        ("Review", Choice({"Accepted": 232, "Rejected": 5})),
        ("Timestamp", Timestamp(datetime(2025, 8, 18, 9, 0, 0), datetime(2025, 9, 3, 23, 0, 0))),
        ("Email Address", Email()),
        ("Full Legal Name", FullName(blank_rows=(0,))),
        ("Preferred Name", PreferredName()),
        ("Email Address", Duplicate(of=2, differs=44)),
        ("Are you an Example College student, alumni or staff? \n"
         "\n"
         "NOTE: Example Makers Fair is open to Example College students, alumni and staff only.\n"
         "\n"
         "We check every application against the college directory, so please answer as you are "
         "enrolled or employed today.",
         Choice({"Yes, I am a current Example College student": 186,
                 "Yes, I am Example College alumni or staff": 51})),
        ("Please provide your Example College email address. If you are alumni or staff, the "
         "address the college gave you is fine, even if you rarely use it.",
         SchoolEmail(count=191)),
        ("If you do not have an Example College email, please upload proof that you study or work "
         "at Example College (a class timetable, an alumni card or a staff card)",
         Upload(count=64)),
        ("Discord username\n"
         "\n"
         "We send table numbers, set-up times and any day-of changes through the fair's Discord "
         "server, so we need a username we can find you by. If you do not have an account yet, "
         "please make one before the fair; it is free and takes a few minutes, and we will invite "
         "you once your application is accepted.\n"
         "\n"
         "(not your display name)",
         Handle()),
        ("Business Name", Business(repeats=1)),
        ("Link to your shop, website or social account", Link("shop", count=213)),
        ("Have you tabled at a market before? Where?",
         Prose(TABLING_SENTENCES, count=194, shared={"No": 4, "Yes": 3, "yes": 2})),
        ("What do you plan to sell at the fair?",
         MultiSelect({"Stickers": 126, "Keychains": 124, "Art prints": 115, "Jewellery": 88,
                      "Fibre arts (crochet, knitting, etc)": 40, "Clothing": 21, "Pottery": 14},
                     rare=(1,) * 109 + (2,) * 11 + (3,) * 2, only_rare=14)),
        ("Please share a link to your portfolio or to photos of the work you will bring to "
         "Example Makers Fair. (Instagram, a website or a shared folder all work, as long as it "
         "shows recent pieces)\n"
         "\n"
         "If your portfolio is private, please make it viewable by anyone with the link until "
         "applications close, so the review team can see it.",
         Link("portfolio", count=237)),
        ("I confirm that everything I sell at Example Makers Fair is designed and made by me, and "
         "that I have the right to sell it.\n"
         "\n"
         "Resold goods, dropshipped goods and work traced from someone else's art are not allowed. "
         "If we find any at your table on the day, we may ask you to pack up and leave.\n"
         "\n"
         "Fan art is welcome, as long as the drawing itself is yours.",
         Constant("I confirm")),
        ("I confirm that my work follows the fair's content rules.\n"
         "\n"
         "The fair is held in a public building and families walk through it, so:\n"
         "- No work that shows graphic violence or sexual content.\n"
         "- No work that targets a person or a group of people.\n"
         "- Keep anything for an older audience in a closed binder, and ask for ID before showing "
         "it.\n"
         "\n"
         "If you are not sure whether a piece is allowed, message the team on Discord before the "
         "fair and we will tell you.",
         Constant("I confirm")),
        ("Which of these clubs do you belong to?",
         Choice({"I am not a member of any of these clubs": 182,
                 "Example College Printmaking Society": 24,
                 "Example College Anime Society": 16,
                 "Example College Ceramics Society": 11,
                 "Example College Visual Arts Society": 3,
                 "Example College Anime Society, Example College Printmaking Society": 1})),
        ("If you belong to one of these clubs, please upload proof of membership. \n"
         "\n"
         "(a screenshot of your membership email or your club card works)",
         Upload(count=50)),
        # Columns 19 to 23: the five days, the last keeping everyone available on one of them.
        *((DAY_GRID.format(day), GridDay(counts, earlier=() if day[0] != "F" else (19, 20, 21, 22)))
          for day, counts in (
            ("Monday, October 20", {"None": 71, "Gold, Silver, Bronze": 56, "Gold": 48,
                                    "Gold, Silver": 38, "Silver": 12, "Silver, Bronze": 7,
                                    "Bronze": 4, "Gold, Silver, Bronze, None": 1}),
            ("Tuesday, October 21", {"None": 98, "Gold, Silver, Bronze": 50, "Gold": 46,
                                     "Gold, Silver": 22, "Silver": 9, "Silver, Bronze": 8,
                                     "Bronze": 3, "Gold, Silver, Bronze, None": 1}),
            ("Wednesday, October 22", {"None": 92, "Gold, Silver, Bronze": 49, "Gold, Silver": 42,
                                       "Gold": 36, "Silver": 9, "Silver, Bronze": 6, "Bronze": 2,
                                       "Gold, Silver, Bronze, None": 1}),
            ("Thursday, October 23", {"None": 98, "Gold, Silver, Bronze": 48, "Gold": 44,
                                      "Gold, Silver": 29, "Silver": 7, "Silver, Bronze": 6,
                                      "Bronze": 4, "Gold, Silver, Bronze, None": 1}),
            ("Friday, October 24", {"Gold, Silver, Bronze": 68, "None": 56, "Gold": 48,
                                    "Gold, Silver": 41, "Silver, Bronze": 11, "Bronze": 6,
                                    "Silver": 6, "Gold, Silver, Bronze, None": 1}),
        )),
        ("Maximum number of days you would like a table",
         Choice({"2 days": 77, "3 days": 58, "5 days": 47, "1 day": 33, "4 days": 22})),
        ("Would you like a half table or full table?\n"
         "\n"
         "NOTE:\n"
         "- A half table is half the width and half the fee of a full table.\n"
         "- Choose Either if you are happy with whichever we have room for.\n"
         "- Half tables are shared, so tell us below if you have a partner in mind. ",
         Choice({"Full table": 89, "Either": 86, "Half table": 62})),
        ("If you chose half table or either, who would you like to share your table with?\n"
         "\n"
         "Please give their email address exactly as they wrote it on their own application.\n"
         "\n"
         "NOTE:\n"
         "- Both of you must apply separately.\n"
         "- If you leave this blank, we will pair you with another vendor where we can.\n"
         "- Your partner must also choose a half table or either.\n"
         "- We try to honour every pairing but cannot promise it.",
         TableShare(applicants=25, outsiders=4, pairs=1,
                    words={"no": 3, "N/A": 2, "Not sure yet": 2, "my friend from class": 1,
                           "anyone is fine": 1, "Still deciding": 1, "none": 1, "n/a": 1,
                           "Whoever needs a partner": 1, "I will ask around": 1, "nobody": 1,
                           "Someone from my club": 1})),
        ("I understand that if I do not come on a day I was given a table, I may not be offered a "
         "table at the next fair.",
         Constant("I understand")),
        ("Anything else you would like us to know?",
         Prose(COMMENT_SENTENCES, count=87, shared={"Thank you!": 3})),
        ("Column 1", Note(count=1)),
    ],
)

TWO_TIER_GRID = (
    "Which tables would you take on each day of the fair? Tick both tiers if either works for you.\n"
    "\n"
    "NOTE: \n"
    "- Gold tables face the front entrance of Example Hall; Silver tables are in the North Wing "
    "and cost a little less.\n"
    "- Leave a day at None if you cannot be there, and we will not give you a table that day.\n"
    "- The more days and tiers you tick, the better your chance of a table. [{}]"
)

TEAM_STATUS_COLUMN = Form(
    file="team-status-column.csv",
    seed=27,
    rows=250,
    # Two applicants stopped after the first page; the organizer tried the form once at the end.
    stopped=(72, 129),
    stopped_at=10,
    test_from=3,
    columns=[
        ("STATUS", Choice({"Accepted": 243, "Rejected": 3, "Waitlisted": 2, "Withdrew": 1,
                           "Duplicate entry": 1})),
        ("Timestamp", Timestamp(datetime(2026, 2, 23, 9, 0, 0), datetime(2026, 3, 9, 23, 0, 0))),
        ("Email Address", Email(pasted=(2,))),
        ("Full Legal Name", FullName(blank_rows=(0,))),
        ("Preferred Name", PreferredName()),
        ("Email Address", Duplicate(of=2, differs=51)),
        ("Are you an Example College student, alum or staff member? \n"
         "\n"
         "NOTE: Only Example College students, alumni and staff may sell at Example Makers Fair.\n"
         "\n"
         "If you are not, you are welcome to visit the fair as a shopper.",
         Choice({"Yes, I am a current Example College student": 178,
                 "Yes, I am Example College alumni or staff": 69,
                 "No, I am not part of Example College, and I understand my application will not "
                 "be considered.": 2})),
        ("Please give your Example College email address. Alumni and staff may give the address "
         "the college gave them, even if they no longer use it often.",
         SchoolEmail(count=200)),
        ("If you have no Example College email, please upload something that shows you study or "
         "work at Example College, such as a class timetable or a staff card.",
         Upload(count=57)),
        ("Discord username\n"
         "\n"
         "The fair's team talks to vendors on Discord: your table, your set-up time and any change "
         "on the day all come through it. Please give the username we can find you by, and join "
         "the server when we invite you.\n"
         "\n"
         "(your username, not your display name)",
         Handle()),
        ("Business Name", Business()),
        ("Link to your business (a shop, a website or a page)", Link("shop", count=223)),
        ("Have you sold your work at a market or fair before?",
         Prose(TABLING_SENTENCES, count=209, most=3, shared={"Yes": 3})),
        ("What will you be selling at the fair?",
         MultiSelect({"Stickers": 141, "Keychains": 134, "Art prints": 121, "Jewellery": 70,
                      "Fibre arts (crochet, knitting, etc)": 44, "Clothing": 27, "Pottery": 18},
                     rare=(1,) * 121 + (2,) * 7 + (3,) * 4 + (4,), only_rare=17)),
        ("If you plan to sell rings, which sizes will you bring? \n"
         "\n"
         "A range is fine; leave this blank if you are not selling rings.",
         Prose(RING_SIZES, count=20, most=1, shared={"N/A": 5, "NA": 3, "No rings": 2})),
        ("Please upload one short video of you making a piece of your work, so the review team can "
         "see it is made by hand (a phone video is fine).",
         Upload(count=113)),
        ("Please upload any sketches or work-in-progress photos of the pieces you will bring.",
         Upload(count=139)),
        ("Please share a link to your portfolio or to photos of what you will bring to Example "
         "Makers Fair.\n"
         "\n"
         "A website, a social page or a shared folder all work, as long as it shows recent "
         "pieces.\n"
         "\n"
         "If it is private, please let anyone with the link view it until applications close.\n"
         "\n"
         "We look at every portfolio, and the more of your current work it shows, the easier "
         "it is for us to say yes. \n"
         "\n"
         "Please do not send a link that asks us to sign in.",
         Link("portfolio", count=247)),
        ("I confirm that everything I sell at the fair is designed and made by me.\n"
         "\n"
         "Resold, dropshipped and traced work is not allowed, and the team may ask a vendor "
         "selling it to pack up and leave.\n"
         "\n"
         "Fan art is welcome, as long as the drawing is your own.",
         Constant("I confirm")),
        ("Example Makers Fair's mission is to give student and alumni makers a first place to "
         "sell their work. \n"
         "\n"
         "Tables go first to makers who have not sold at many markets before. \n"
         "\n"
         "I have read the fair's mission and agree to support it.\n",
         Constant("I agree")),
        ("I confirm that everything in this application is true and that it is my own.\n"
         "\n"
         "An application made for someone else, or copied from another, will not be considered.",
         Constant("I confirm")),
        ("I confirm that my work follows the fair's content rules.\n"
         "\n"
         "Families walk through the fair, so:\n"
         "\n"
         "- No work showing graphic violence or sexual content. \n"
         "- No work aimed at a person or a group of people.\n"
         "- Keep work for an older audience in a closed binder, and ask for ID first.\n"
         "- If you are unsure about a piece, ask the team on Discord before the fair.",
         Constant("I confirm")),
        ("Which clubs are you part of?",
         Choice({"I am not a member of any of these clubs": 183,
                 "Example College Printmaking Society": 27,
                 "Example College Anime Society": 21,
                 "Example College Ceramics Society": 12,
                 "Example College Printmaking Society, Example College Anime Society": 2,
                 "Example College Ceramics Society, I am not a member of any of these clubs": 1,
                 "Example College Anime Society, I am not a member of any of these clubs": 1})),
        ("If you are in one of these clubs, please upload proof of membership.\n",
         Upload(count=53)),
        # Columns 24 to 28: the five days, the last keeping everyone available on one of them.
        *((TWO_TIER_GRID.format(day),
           GridDay(counts, earlier=() if day[0] != "F" else (24, 25, 26, 27)))
          for day, counts in (
            ("Monday, April 20", {"None": 89, "Gold, Silver": 88, "Gold": 51, "Silver": 18,
                                  "Silver, None": 1}),
            ("Tuesday, April 21", {"None": 102, "Gold, Silver": 87, "Gold": 42, "Silver": 16}),
            ("Wednesday, April 22", {"Gold, Silver": 94, "None": 68, "Gold": 65, "Silver": 19,
                                     "Silver, None": 1}),
            ("Thursday, April 23", {"Gold, Silver": 94, "None": 91, "Gold": 46, "Silver": 16}),
            ("Friday, April 24", {"Gold, Silver": 103, "Gold": 64, "None": 62, "Silver": 16,
                                  "Gold, Silver, None": 1, "Silver, None": 1}),
        )),
        ("Maximum number of days you want a table",
         Choice({"2 days": 86, "3 days": 60, "5 days": 46, "1 day": 33, "4 days": 22})),
        ("Do you want a half table or full table?\n"
         "\n"
         "- A half table is half the width and half the fee of a full table.\n"
         "- Half tables are shared with another vendor.\n"
         "- Choose Either if you are happy with whichever we have room for.\n"
         "- We cannot change your table size after results are out. ",
         Choice({"Full table": 87, "Either": 85, "Half table": 75})),
        ("If you chose half table or either, who would you like to share with?\n"
         "\n"
         "Give their email address as they wrote it on their own application.\n"
         "\n"
         "NOTE:\n"
         "- Each of you must apply on your own.\n"
         "- Your partner must also choose a half table or either.\n"
         "- Leave this blank and we will pair you with another vendor where we can.\n"
         "- We try to keep every pair together but cannot promise it.",
         TableShare(applicants=43, outsiders=2, pairs=0,
                    words={"No": 2, "N/A": 1, "Not sure yet": 1, "my friend from class": 1,
                           "anyone is fine": 1, "Still deciding": 1, "none": 1,
                           "Whoever needs a partner": 1, "I will ask around": 1, "Not yet": 1,
                           "Someone from my club": 1})),
        ("I understand that if I do not come on a day I was given a table, without telling the "
         "team beforehand, I may not be offered a table at the next Example Makers Fair.",
         Constant("I understand")),
        ("Anything else you would like the team to know before the fair? (optional)",
         Prose(COMMENT_SENTENCES, count=74, shared={"Thank you!": 2, "Can't wait!": 2})),
        # Added to the form after it opened, so the first applicants never saw it.
        ("Please share a link to a video of your process, if you did not upload one. ",
         Link("video", count=214, shared={"N/A": 6, "See below": 4, "Below": 3})),
    ],
)

CEILING_GRID = (
    "For each day, choose every table tier you would take. Choose None for a day you cannot "
    "attend.\n"
    "\n"
    "NOTE:\n"
    "- Gold tables are in the North Wing of Example Hall, Silver tables in the South Wing and "
    "Bronze tables in the lobby; Bronze costs the least.\n"
    "- Each vendor is given a table on up to 2 days in total, even if you choose more.\n"
    "- We will never place you on a day you left at None, or at a tier you did not choose.\n"
    "\n"
    "Choosing more tiers and days makes it more likely we can find you a table. [{}]"
)

NO_TIMESTAMP = Form(
    file="no-timestamp.csv",
    seed=25,
    rows=237,
    columns=[
        # The team's review columns first; the sheet was saved without the form's timestamp.
        ("Status", Choice({"approved": 230, "rejected": 7})),
        ("Screening Notes", Prose(NOTE_SENTENCES, count=42)),
        ("Full Name", FullName()),
        ("Preferred Name", PreferredName()),
        ("Email Address", Email(name_only=(50,), named=(95,))),
        ("Are you an Example College student or alum?\n"
         "\n"
         "NOTE: Example Makers Fair is for Example College students, alumni and staff.\n"
         "\n"
         "We may ask to see a student or staff card at the door.",
         Choice({"Yes, I am a current Example College student": 179,
                 "Yes, I am Example College alumni or staff": 57,
                 "No, I am not part of Example College, and I understand my application will not "
                 "be considered.": 1})),
        ("Please provide your Example College email address (alumni and staff may give the one "
         "the college issued to them).",
         SchoolEmail(count=203)),
        ("If you do not have an Example College email, please upload proof that you belong to "
         "Example College (a timetable, an alumni card or a staff card).",
         Upload(count=54)),
        ("Discord Username\n"
         "\n"
         "We share table numbers and news on the day through the fair's Discord server.\n"
         "\n"
         "(your username, not your display name)",
         Handle()),
        ("Business Name", Business()),
        ("Where can we find your business online? (one link)", Link("shop", count=213)),
        ("Have you had a table at a market or fair before?",
         Prose(TABLING_SENTENCES, count=195, most=3, shared={"No": 3, "Yes": 3, "N/A": 2})),
        ("What are you planning to sell?",
         MultiSelect({"Stickers": 121, "Keychains": 110, "Art prints": 108, "Jewellery": 78,
                      "Fibre arts (crochet, knitting, etc)": 49, "Clothing": 36, "Pottery": 18},
                     rare=(5, 4, 3) + (2,) * 8 + (1,) * 123, only_rare=37)),
        ("Please share a link to your portfolio or to photos of the pieces you plan to bring to "
         "Example Makers Fair. A website, a social page or a shared folder all work.\n"
         "\n"
         "If your portfolio is private, please let anyone with the link view it until "
         "applications close.",
         Link("portfolio", count=237)),
        ("I certify that everything I will sell at the fair is designed and made by me, and that "
         "I have the right to sell it.\n"
         "\n"
         "Resold goods, dropshipped goods and work traced from another artist are not allowed. Fan "
         "art is welcome as long as the drawing is my own, but I will not sell copies of official "
         "merchandise.\n"
         "\n"
         "If the team finds work at my table that breaks this rule, they may ask me to take it "
         "down or to leave the fair, and I may not be offered a table next time.",
         Constant("I certify")),
        ("I certify that the work I will sell follows the fair's content rules, posted at "
         "https://example.com/fair-rules.\n"
         "\n"
         "Example Hall is a public building and families walk through the fair, so:\n"
         "- No work showing graphic violence or sexual content.\n"
         "- No work that targets a person or a group of people.\n"
         "- Work for an older audience is kept in a closed binder, and I will ask for ID before "
         "showing it.\n"
         "\n"
         "If I am not sure whether a piece is allowed, I will message the team on Discord before "
         "the fair, and I understand the team may ask me to take down a piece that breaks these "
         "rules.",
         Constant("I certify")),
        ("Which of these clubs are you in?",
         MultiSelect({"I am not a member of any of these clubs": 170,
                      "Example College Printmaking Society": 31,
                      "Example College Anime Society": 31,
                      "Example College Ceramics Society": 13,
                      "Example College Visual Arts Society": 2},
                     rare=(), only_rare=0)),
        ("If you ticked a club, please upload something that shows you are a member.",
         Upload(count=58)),
        # Columns 18 to 22: the five days, the last keeping everyone available on one of them.
        *((CEILING_GRID.format(day),
           GridDay(counts, earlier=() if day[0] != "F" else (18, 19, 20, 21)))
          for day, counts in (
            ("Monday, May 19th", {"None": 78, "Gold": 63, "Gold, Silver": 42,
                                  "Gold, Silver, Bronze": 34, "Silver": 12, "Silver, Bronze": 5,
                                  "Bronze": 3}),
            ("Tuesday, May 20th", {"None": 88, "Gold": 57, "Gold, Silver": 43,
                                   "Gold, Silver, Bronze": 31, "Silver": 11, "Bronze": 4,
                                   "Silver, Bronze": 3}),
            ("Wednesday, May 21st", {"None": 81, "Gold": 56, "Gold, Silver": 47,
                                     "Gold, Silver, Bronze": 35, "Silver": 11,
                                     "Silver, Bronze": 4, "Bronze": 3}),
            ("Thursday, May 22nd", {"None": 89, "Gold": 60, "Gold, Silver, Bronze": 36,
                                    "Gold, Silver": 34, "Silver": 7, "Silver, Bronze": 5,
                                    "Bronze": 4, "Gold, Silver, None": 1, "Silver, None": 1}),
            ("Friday, May 23rd", {"Gold": 71, "None": 57, "Gold, Silver": 46,
                                  "Gold, Silver, Bronze": 40, "Silver": 10, "Silver, Bronze": 7,
                                  "Bronze": 5, "Gold, Silver, None": 1}),
        )),
        ("Which table size would you like, a half table or full table? Tick all that suit you.\n"
         "\n"
         "- A full table is about two metres wide; a half table is half of one, at half the fee.\n"
         "- Half tables are shared with another vendor.\n"
         "- Either means you are happy with whichever we have room for.\n"
         "- Your choice cannot change after results are out. ",
         Choice({"Full table": 87, "Either": 66, "Half table": 65, "Full table, Either": 11,
                 "Half table, Either": 6, "Full table, Half table": 2})),
        ("If you chose a half table or Either, who would you like to share a table with?\n"
         "\n"
         "Please give your partner's email address, as they wrote it on their own application.\n"
         "\n"
         "NOTE:\n"
         "- You and your partner must each apply.\n"
         "- Your partner must also choose a half table or Either.\n"
         "- Leave this blank and we will pair you with another vendor where we can.\n"
         "- We try to keep every pair together, but cannot promise it.",
         TableShare(applicants=31, outsiders=3, pairs=2,
                    words={"N/A": 7, "no": 4, "Not sure yet": 3, "my friend from class": 1,
                           "anyone is fine": 1, "Still deciding": 1, "none": 1,
                           "Whoever needs a partner": 1, "I will ask around": 1,
                           "Someone from my club": 1})),
        ("I understand that a vendor who arrives after set-up closes may lose their table for "
         "that day.",
         Constant("I understand")),
        ("I understand that if I do not come on a day I was given a table, and do not tell the "
         "team a week before, I may not be offered a table at the next Example Makers Fair.",
         Constant("I understand")),
        ("Anything else you would like to tell us? Questions, requests and comments are welcome.",
         Prose(COMMENT_SENTENCES, count=69, shared={"Thank you!": 3})),
    ],
)

FOUR_DAY_GRID_STEM = (
    "For each day of the fair, choose the table tiers you would like. Choose None for a day you "
    "are not free.\n"
    "\n"
    "Each vendor may table for up to 3 days, but please choose every day you are free.\n"
    "\n"
    "NOTE: \n"
    "- Your table must be staffed for at least four hours on each day you are given; ask a friend "
    "to cover it if you need a break.\n"
    "- Of the tiers you choose, you will be given the best one that is still open.\n"
    "- If none of the tiers you chose is open on a day, you may not get a table that day. [{}]"
)

FOUR_DAY_GRID = Form(
    file="four-day-grid.csv",
    seed=28,
    rows=361,
    # The last two rows are the team's: its checkbox column filled in beside no response. Three
    # applicants sent the form twice.
    typed=(359, 360),
    repeats=((54, 55), (78, 79), (136, 216)),
    columns=[
        # The team's checkbox column, before the form's first.
        ("Ck", Constant("FALSE", blank_rows=(211,))),
        ("Timestamp", Timestamp(datetime(2024, 2, 25, 9, 0, 0), datetime(2024, 3, 12, 23, 0, 0))),
        ("Full Name", FullName()),
        ("Preferred Name", PreferredName(blank=72)),
        ("Email Address", Email()),
        ("Discord Username\n"
         "\n"
         "The team shares table numbers and day-of updates on the fair's Discord server.\n"
         "\n"
         "(the username, not the display name)",
         Handle()),
        ("Business Name", Business(repeats=3)),
        ("Business Instagram (optional)", Social("instagram", count=324)),
        ("Business Twitter (optional)",
         Social("twitter", count=51, shared={"N/A": 6, "NA": 5, "n/a": 3})),
        ("Business Website (optional)", Link("shop", count=155, shared={"NA": 4})),
        ("Other Business Socials (optional)", Social("social", count=68, shared={"NA": 5})),
        ("Tell us about any markets or fairs you have tabled at before.",
         Prose(TABLING_SENTENCES, count=284, most=3, shared={"No": 3})),
        ("What kinds of work will you sell?",
         MultiSelect({"Stickers": 181, "Art prints": 167, "Keychains": 151, "Jewellery": 124,
                      "Fibre arts (crochet, knitting, etc)": 65, "Clothing": 56, "Pottery": 15},
                     rare=(5, 5, 4, 4, 4, 3, 3) + (2,) * 13 + (1,) * 201, only_rare=38)),
        ("Please link to a portfolio or to photos of the work you plan to sell at Example Makers "
         "Fair (a website, a social page or a shared folder).\n"
         "\n"
         "Make sure anyone with the link can open it, so the review team can look at your recent "
         "work before applications close.",
         Link("portfolio", count=359)),
        ("I certify that I designed and made the work I will sell, and that none of it is resold, "
         "dropshipped or traced. If a piece uses someone else's pattern, I will say so in my "
         "comments and show that I may sell it. \n"
         "\n"
         "A vendor found breaking this rule may be asked to leave and may not be offered a table "
         "again.\n"
         "\n"
         "(Work printed or put together for me by a manufacturer is fine, as long as the design "
         "is mine.)",
         Constant("I certify that the work is my own")),
        ("Are you an Example College student?\n"
         "\n"
         "NOTE: Example College students are offered tables first, and we check every answer "
         "against the college directory.",
         Choice({"Yes": 186, "No": 173})),
        # Read as one choice: hardly anyone named two clubs, and the rules cannot tell.
        ("Which clubs are you in?",
         Choice({"I am not a member of any of these clubs": 278,
                 "Example College Printmaking Society": 62,
                 "Example College Anime Society": 15,
                 "Example College Printmaking Society, I am not a member of any of these clubs": 2,
                 "Example College Printmaking Society, Example College Anime Society": 1,
                 "ECVAS": 1})),
        ("If you are in a club above, please upload proof that you are a member",
         Upload(count=76)),
        # Columns 18 to 21: the four days, the last keeping all but one applicant available on one
        # of them.
        *((FOUR_DAY_GRID_STEM.format(day),
           GridDay(counts, earlier=() if day[:3] != "Thu" else (18, 19, 20),
                   unavailable=0 if day[:3] != "Thu" else 1))
          for day, counts in (
            ("Mon, April 22nd", {"None": 93, "Gold": 91, "Gold, Silver": 58,
                                 "Gold, Silver, Bronze": 56, "Silver": 33, "Bronze": 14,
                                 "Silver, Bronze": 11, "Silver, Bronze, None": 2,
                                 "Gold, Silver, Bronze, None": 1}),
            ("Tue, April 23rd", {"None": 120, "Gold": 76, "Gold, Silver, Bronze": 50,
                                 "Gold, Silver": 49, "Silver": 33, "Bronze": 16,
                                 "Silver, Bronze": 12, "Silver, Bronze, None": 2,
                                 "Bronze, None": 1}),
            ("Wed, April 24th", {"None": 103, "Gold": 85, "Gold, Silver, Bronze": 57,
                                 "Gold, Silver": 50, "Silver": 33, "Silver, Bronze": 15,
                                 "Bronze": 14, "Gold, Silver, Bronze, None": 1,
                                 "Silver, Bronze, None": 1}),
            # One applicant left this day blank.
            ("Thu, April 25th", {"None": 127, "Gold": 78, "Gold, Silver, Bronze": 51,
                                 "Gold, Silver": 43, "Silver": 31, "Bronze": 17,
                                 "Silver, Bronze": 9, "Gold, Silver, Bronze, None": 1,
                                 "Silver, Bronze, None": 1}),
        )),
        ("Would you like a half table or full table?\n"
         "\n"
         "NOTE:\n"
         "- A half table costs half as much as a full table.\n"
         "- A half table is shared, perhaps with a vendor you do not know yet.\n"
         "- There are fewer full tables, so choosing Either gives you a better chance of a table.",
         Choice({"Full table only": 154, "Either": 106, "Half table only": 99})),
        ("If you chose a half table, is there someone you would like to share it with?\n"
         "\n"
         "Please write their email address exactly.\n"
         "\n"
         "NOTE:\n"
         "- They must send an application of their own.\n"
         "- We will try to seat you together, but cannot promise it.\n"
         "- The address must match the one on their application, so check it with them.\n"
         "- You can only share if you both come on the same days and choose the same tiers.",
         TableShare(applicants=68, outsiders=5, pairs=0,
                    words={"No": 5, "N/A": 2, "n/a": 2, "Not sure yet": 2,
                           "my friend from class": 1, "anyone is fine": 1, "Still deciding": 1,
                           "none": 1, "Whoever needs a partner": 1, "I will ask around": 1,
                           "nobody": 1, "Someone from my club": 1, "Not yet": 1, "no one": 1,
                           "My sister": 1, "TBD": 1, "Will email you": 1,
                           "A friend, applying soon": 1, "Not decided": 1, "Open to anyone": 1,
                           "Maybe": 1, "Anyone": 1})),
        ("I understand that tables and days cannot be swapped once the market days are confirmed.",
         Constant("I understand")),
        ("I understand that a vendor who does not come, without telling the team, will not be "
         "refunded, and may not be offered a table at a later fair.",
         Constant("I understand")),
        ("Any other comments?",
         Prose(COMMENT_SENTENCES, count=119, shared={"Thank you!": 2})),
        # Two empty columns after the form's last, then the team's notes under no heading.
        ("", Blank()),
        ("", Blank()),
        ("", Prose(NOTE_SENTENCES, count=4, most=1, shared={"Called, no answer yet.": 2})),
    ],
)

FAIR_DAYS = ("Monday, October 23rd", "Tuesday, October 24th", "Wednesday, October 25th",
             "Thursday, October 26th", "Friday, October 27th")


def _days(counts: Dict[str, int]) -> Dict[str, int]:
    """Checkbox answers of the fair's days, each written as letters (M, T, W, R, F) for brevity,
    joined by ", " as Google joins them, so each day's own comma sits inside the answer."""
    return {", ".join(day for letter, day in zip("MTWRF", FAIR_DAYS) if letter in letters): count
            for letters, count in counts.items()}


DAYS_AS_ONE_QUESTION = Form(
    file="days-as-one-question.csv",
    seed=23,
    rows=294,
    # Seven blank lines the sheet kept; ten second sends, one of them under another name.
    empty=(11, 41, 83, 126, 168, 210, 253),
    repeats=((4, 211), (23, 199), (50, 270), (59, 148), (59, 197), (107, 177), (127, 218),
             (149, 281), (174, 245), (266, 268)),
    renamed=(270,),
    columns=[
        ("Timestamp", Timestamp(datetime(2023, 8, 22, 9, 0, 0), datetime(2023, 9, 12, 23, 0, 0))),
        # The team's column, after the form's first.
        ("Approved",
         Prose(NOTE_SENTENCES, count=250, shared={"Y": 196, "Y, half table": 3,
                                                  "N - link broken": 3, "y": 2,
                                                  "N - not a student": 2,
                                                  "Y - check the link": 2})),
        ("Full Name", FullName()),
        ("Email Address", Email()),
        ("Are you an Example College student?", Choice({"Yes": 180, "No": 107})),
        ("If you belong to any of these clubs, which ones?",
         Choice({"Example College Printmaking Society": 14, "Example College Anime Society": 16,
                 "Example College Ceramics Society": 15, "ECVAS": 9,
                 "Example College Printmaking Society, Example College Anime Society": 3,
                 "Example College Printmaking Society, Example College Ceramics Society": 3})),
        ("Do you need a half table or full table?",
         Choice({"Full table": 170, "Half table": 117})),
        ("Tick every day you can come to the fair.",
         Choice(_days({"MTWRF": 71, "MWF": 40, "WRF": 19, "RF": 16, "TWR": 12, "MTW": 11,
                       "MRF": 11, "MTRF": 10, "MWRF": 9, "MTF": 8, "TWRF": 8, "MTWR": 8, "WF": 8,
                       "F": 7, "MTR": 7, "MF": 7, "M": 5, "TRF": 5, "WR": 4, "MTWF": 3, "TW": 3,
                       "MW": 3, "TF": 3, "R": 2, "MWR": 2, "W": 1, "TWF": 1, "T": 1, "MT": 1,
                       "TR": 1}))),
        ("What experience do you have selling at markets or fairs?",
         Prose(TABLING_SENTENCES, count=287, most=3, shared={"No": 79, "Not yet": 2})),
        ("What will you bring to sell?",
         MultiSelect({"Art prints": 153, "Stickers": 143, "Keychains": 115, "Jewellery": 92,
                      "Clothing": 52, "Weaving": 23},
                     rare=(6, 4, 4, 4) + (3,) * 8 + (2,) * 8 + (1,) * 178, only_rare=37)),
        ("Please link to a portfolio or a page of your recent work, so the team can see what you "
         "make!",
         Link("portfolio", count=287)),
        ("Anything else we should know?",
         Prose(COMMENT_SENTENCES, count=135, shared={"Thank you!": 3})),
    ],
)

FORMS = (FIVE_DAY_GRID, TEAM_STATUS_COLUMN, NO_TIMESTAMP, FOUR_DAY_GRID, DAYS_AS_ONE_QUESTION)


def main() -> None:
    for form in FORMS:
        with open(os.path.join(CORPUS, form.file), "wb") as handle:
            handle.write(form.bytes())
        print(f"wrote {form.file}: {form.rows} rows, {len(form.columns)} columns")


if __name__ == "__main__":
    main()
