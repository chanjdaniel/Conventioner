# 04: Does a model beat the rules?

Type: task
Status: open
Blocked by: 01, 02, 03

## Question

Put the questions the rules got wrong or could not ask ([03](03-how-good-are-the-rules-alone.md)) to hosted Jev, under the boundary [01](01-what-hosted-jev-may-be-sent.md) settled, and to the best local candidate [02](02-what-jev-and-its-lookalikes-can-do.md) found (a zero-shot NLI classifier such as deberta-v3 `zeroshot-v2.0`, or GLiClass; not Laya or JEV-CPU, which are near chance by their own numbers), on the same corpus and the same hand-written answers.
Measure accuracy per question, latency per file, and cost per file.

The target is narrow ([03](03-how-good-are-the-rules-alone.md)): the rules miss nothing in the corpus that a view holds the evidence for.
What a model could add is judgement on header text, which is safe to send: whether a column after the questions is an organizer's note, and a ceiling on days stated in unusual prose.
Neither occurs in the corpus, so measure them on the header wordings in the research branch's `stress.py`, extended, and hold the model to the corpus scorecard as well: it must not lose what the rules get right.

Decide, for hosted and for local separately: **go** (which questions it answers, and what it costs to run), or **no-go** (ruled out of scope on this map with the numbers that ruled it out).
A model that only ties the rules is a no-go: it adds a dependency and a failure mode for nothing.
