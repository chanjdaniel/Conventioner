# 04: Does a model beat the rules?

Type: task
Status: resolved
Blocked by: 01, 02, 03

## Question

Put the questions the rules got wrong or could not ask ([03](03-how-good-are-the-rules-alone.md)) to hosted Jev, under the boundary [01](01-what-hosted-jev-may-be-sent.md) settled, and to the best local candidate [02](02-what-jev-and-its-lookalikes-can-do.md) found (a zero-shot NLI classifier such as deberta-v3 `zeroshot-v2.0`, or GLiClass; not Laya or JEV-CPU, which are near chance by their own numbers), on the same corpus and the same hand-written answers.
Measure accuracy per question, latency per file, and cost per file.

The target is narrow ([03](03-how-good-are-the-rules-alone.md)): the rules miss nothing in the corpus that a view holds the evidence for.
What a model could add is judgement on header text, which is safe to send: whether a column after the questions is an organizer's note, and a ceiling on days stated in unusual prose.
Neither occurs in the corpus, so measure them on the header wordings in the research branch's `stress.py`, extended, and hold the model to the corpus scorecard as well: it must not lose what the rules get right.

Decide, for hosted and for local separately: **go** (which questions it answers, and what it costs to run), or **no-go** (ruled out of scope on this map with the numbers that ruled it out).
A model that only ties the rules is a no-go: it adds a dependency and a failure mode for nothing.

## Plan: local first

Settled 2026-09-27; hosted Jev waits on this half.

**Questions.** Only the two [03](03-how-good-are-the-rules-alone.md) left to judgement: Q1, is a column an organizer's note or an applicant question; Q2, what ceiling on days per vendor a header's prose states, if any.
The model answers only these and never overrides a confident rule; the corpus scorecard is rerun with it in place to prove it loses nothing.

**Test set.** Written blind by a subagent that never saw the rules or the scorecard: about 60 items per question, half hard negatives, headers plus an invented shape and no row values.
A fixed third is held out and read once, for the final numbers.

**Candidates**, chosen from JevBench v1.3's intelligence-only ranking rather than the NLI classifiers first planned (deberta-v3-large NLI scored 13.0 there, GLiNER2 at most 25.9):

| Candidate | Size | JevBench intelligence |
|---|---|---|
| SemIf on Qwen3.5-4B | 4B | 79.0 |
| decider-2b (Qwen3.5-2B, fine-tuned) | 1.9B | 61.2 |
| kev 0.6B | 0.6B | 51.9 |
| Laya, as the small-encoder reference | 421M | 38.5 |

Hosted Jev scores 85.7. system-one-open (Gemma 4 E2B, 69.5) joins if its weights are published.

**Measured.** Accuracy per question, with the costly errors counted apart (dropping a real question; inventing a ceiling); whether a confidence threshold exists above which the model is nearly always right; CPU latency per question and per file, also at 2 threads to approximate a server; peak memory; weights on disk.

**Go**, per candidate, only if on the held-out third it beats the rules by at least 10 points on Q1 or Q2, makes no more costly errors than the rules, answers a file's questions in 5 s or less on CPU, and adds 3 GB or less of weights and memory.
Otherwise no-go; a tie is a no-go.

## Local: measured

Measured 2026-09-27; scripts, test set and every result are on the local branch `research/local-models`, in `.scratch/wayfinding/the-form-started-from-a-csv/research/04-local-models/`.

**By the thresholds set in advance, every local candidate is a no-go, and for cost rather than accuracy: three of them turn Q2 from 50% to 90%, but none fits in 3 GB, and the 4B that also helps Q1 takes 30 s a file.**

Each model answers only where the rules have nothing to say, above a threshold chosen on the tuning part (the best wording and threshold with no costly error), frozen before the held-out third was read once.

| On the held-out third (20 per question) | Q1 right | Q2 right | Costly (Q1, Q2) | CPU s per question, 2 threads (Q1, Q2) | Peak memory | Weights |
|---|---|---|---|---|---|---|
| Rules alone | 70% | 50% | 0, 1 | - | - | - |
| + decider-2b | 70% | 90% | 0, 1 | 1.2, 1.5 | 3.7 GB | 3.8 GB |
| + Laya | 70% | 50% (no safe threshold) | 0, 1 | 0.4, 0.6 | 3.2 GB | 0.8 GB |
| + SemIf on Qwen3.5-4B (Q4 GGUF) | 80% | 90% | 0, 1 | 5.0, 8.9 | 5.3 GB | 3.0 GB |
| + Kev-0.8B | 75% | 90% | 0, 1 | 0.9, 1.2 | 4.5-5.4 GB | 1.8 GB |

The one costly Q2 error in every row is the rules' own; no model added one on the test set.

- **The corpus guard.** Q1 was put to all 40 real question columns and Q2 to all 30 real headers holding a number. decider-2b and Kev-0.8B made no costly error. SemIf called three "I understand ..." acknowledgements organizer columns at 0.82-0.83; those are checkboxes the rules already place, so in the design it would never be asked, but it shows its Q1 threshold sits close to real mistakes.
- **Per file**, about 4 questions would reach a model (2-3 headers naming days and a number, a grid counting once; 1-2 unplaced columns): about 5 s for decider-2b or Kev at 2 threads, about 30 s for SemIf, on a desktop CPU faster than a typical server.
- **Q1 is hard for every model.** Wording moved decider-2b from answering "organizer" to all 40 tuning items to 68%; only SemIf beat the rules by the margin, and only by 2 items of 20.
- **What each costs is the runtime, not the file.** decider-2b and Kev run in PyTorch (bf16 and fp32); a quantised build of either through llama.cpp would be about a third of the memory, and was not measured. A community GGUF of decider-2b exists.

| Candidate | Accuracy criterion (at least 10 points on Q1 or Q2) | No more costly errors | 5 s or less per file | 3 GB or less | Verdict |
|---|---|---|---|---|---|
| decider-2b | met (Q2 +40) | met | about 5 s, borderline | not met (3.7 GB memory, 3.8 GB weights) | no-go as measured |
| Laya | not met | met | met | not met | no-go |
| SemIf 4B | met (Q1 +10, Q2 +40) | met on the test set; 3 near misses on the corpus | not met (about 30 s) | not met (5.3 GB) | no-go |
| Kev-0.8B | met (Q2 +40) | met | about 5 s, borderline | not met (4.5-5.4 GB) | no-go as measured |

**What the win is worth.** Q2 is one number per market, the ceiling on days per vendor, which the organizer reviews and can type in.
In the corpus the rules already find every stated ceiling (2 of 5 files); a model adds one only where a form words it in a way the rules miss, and that is bought with 2-5 GB resident beside the back end.

**Bookmarked 2026-09-27: Kev-0.8B is the current local pick**, should a local model be wanted later.
It ties the best Q2 result (90%, no costly error), is the fastest of the three that help (about 1 s a question on 2 CPU threads, about 5 s a file), makes no costly error on the corpus, and has the smallest weights (1.8 GB). Its one failing is memory (4.5-5.4 GB running in fp32 PyTorch), which a quantised build is the first thing to try against.
Hosted Jev is measured next, on the same test set, frozen-threshold method and corpus guard.

## Hosted: measured

Measured 2026-09-27 with `jev-1.13.0` through `typesafe-sdk` 0.7.2, on the same test set, the same frozen-threshold method and the same corpus guard; results on `research/local-models`.

| On the held-out third (20 per question) | Q1 right | Q2 right | Costly (Q1, Q2) | Seconds per question |
|---|---|---|---|---|
| Rules alone | 70% | 50% | 0, 1 | - |
| + hosted Jev (Q1 wording C, both at p >= 0.8) | 85% | 95% | 0, 1 | 0.2 |
| + Kev-0.8B, the best local | 75% | 90% | 0, 1 | 0.9-1.2 |

- **The corpus guard**: no costly error on the 40 real question columns or the 30 real headers holding a number.
- **Stable on Q2, slightly noisy on Q1.** Two reruns of the tuning part changed no Q2 answer; Q1 changed 1-2 answers of 40, and one rerun made one costly error at the frozen threshold. Q1 sits close to its threshold, so a column the proposal leaves out must stay visible in the review.
- **Cost and wait.** About 4 questions a file at about 0.2 s each: roughly a second, well inside the 5 s timeout [01](01-what-hosted-jev-may-be-sent.md) set. At $0.042 per million input tokens and a few hundred tokens a question, a file costs a small fraction of a cent.
- **What it was sent**: the synthetic test set, and for the guard the corpus's headers with aggregate shapes; no row value, within [01](01-what-hosted-jev-may-be-sent.md).

## Answer

Resolved 2026-09-27.

**Hosted Jev: go, for the two judgements the rules leave, and only there. Local: no-go as measured, with Kev-0.8B bookmarked.**

- **Hosted Jev answers Q1 and Q2 only where the rules have nothing to say, and only at 0.8 or above.** It met every criterion set in advance: Q1 +15 and Q2 +45 points over the rules on the held-out third, no costly error added there or on the corpus, about a second a file, nothing to install beside the back end.
- **It stays optional**, as [01](01-what-hosted-jev-may-be-sent.md) settled: with no key, or on a failure or a timeout, the rules decide and the column is marked uncertain in the review. What it adds is a pre-filled answer in the review, never a decision the organizer cannot see.
- **Every local candidate misses on cost, not accuracy**: decider-2b, SemIf 4B and Kev-0.8B all lift Q2 to 90%, but none fits in 3 GB, and SemIf takes about 30 s a file. Laya adds nothing. Kev-0.8B is the pick if a local model is ever wanted; a quantised build is the first thing to try.
- **Wording matters.** Q1 is asked as "one of the application form's questions, or a column the market's staff added to record their review" (wording C in the harness); the first wording scored higher raw but made more costly errors.

Built by [E24](../../../backlog/E24-the-form-started-from-a-csv/epic.md).
