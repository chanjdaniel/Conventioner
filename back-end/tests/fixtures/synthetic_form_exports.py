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
a fixture domain, and every other answer is made from the word lists in this file.

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
    """Everyone's answer is the same text: a ticked certification box exports as its own text."""
    value: str

    def cells(self, context):
        return [self.value] * context.rows


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
    of this day's tiers."""
    earlier: Tuple[int, ...] = ()

    def cells(self, context):
        absent = [row for row in context.open_rows if self.earlier
                  and all(context.columns[day][row] == "None" for day in self.earlier)]
        tiers = [value for value, count in self.counts.items() if value != "None"
                 for _ in range(count)]
        context.rng.shuffle(tiers)
        given = dict(zip(absent, tiers))
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
    cell in ``from_column``, an address that is not one."""
    pasted: Tuple[int, ...] = ()
    from_column: int = 1

    def cells(self, context):
        return [context.columns[self.from_column][row] if row in self.pasted else person.email
                for row, person in enumerate(context.people)]


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
    """The name an applicant goes by: their given name."""

    def cells(self, context):
        return [person.given for person in context.people]


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
        rows = set(context.rng.sample(context.open_rows, self.count))
        cells = [f"https://example.com/{self.path}/{p.handle}" if row in rows else ""
                 for row, p in enumerate(context.people)]
        if self.shared:
            words = context.place(self.shared, [row for row in context.open_rows
                                                if row not in rows])
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
class Note(Kind):
    """An organizer's note in a column they added, on ``count`` rows."""
    count: int

    def cells(self, context):
        return context.place({sentence: 1 for sentence in NOTE_SENTENCES[:self.count]})


# ── The forms ───────────────────────────────────────────────────────────────────────────────────


@dataclass
class Form:
    """A form's export. Two kinds of row are the form's own rather than a column's: the
    ``stopped`` applicants, who sent the form with every question from column ``stopped_at`` on
    left blank, and, with ``test_from``, a last row the organizer sent to try the form, "TEST" in
    every column from that one."""
    file: str
    seed: int
    rows: int
    columns: Sequence[Tuple[str, Kind]]
    stopped: Tuple[int, ...] = ()
    stopped_at: int = 0
    test_from: Optional[int] = None

    def people(self, rng: random.Random) -> List[Person]:
        """Distinct applicants: a few share a given name, as people do."""
        shared = max(self.rows // 20, 1)
        given = rng.sample(GIVEN_NAMES, self.rows - shared)
        given += rng.sample(given, shared)
        rng.shuffle(given)
        family = [rng.choice(FAMILY_NAMES) for _ in range(self.rows)]
        people = []
        for row, (first, last) in enumerate(zip(given, family)):
            handle = f"example{first}{last}{row}".lower()
            people.append(Person(first, last, f"{first}.{last}{row}@example.com".lower(), handle))
        return people

    def rows_of_cells(self) -> List[List[str]]:
        rng = random.Random(self.seed)
        context = Context(rng, self.people(rng))
        test_row = self.rows - 1
        for index, (_header, kind) in enumerate(self.columns):
            stopped = set(self.stopped) if self.stopped and index >= self.stopped_at else set()
            tested = {test_row} if self.test_from is not None and index >= self.test_from else set()
            context.closed = frozenset(stopped | tested)
            cells = kind.cells(context)
            for row in stopped:
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

FORMS = (FIVE_DAY_GRID, TEAM_STATUS_COLUMN)


def main() -> None:
    for form in FORMS:
        with open(os.path.join(CORPUS, form.file), "wb") as handle:
            handle.write(form.bytes())
        print(f"wrote {form.file}: {form.rows} rows, {len(form.columns)} columns")


if __name__ == "__main__":
    main()
