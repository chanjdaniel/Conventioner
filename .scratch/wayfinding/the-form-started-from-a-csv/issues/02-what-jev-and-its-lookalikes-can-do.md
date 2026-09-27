# 02: What can Jev and its local lookalikes actually do?

Type: research
Status: resolved
Blocked by: -

## Question

The brain dump's Jev notes were a day old and partly sourced from pages that read like SEO content.
Confirm each claim against the vendor's or the model's own documentation and repository, and answer:

- **Hosted Jev (TypeSafe):** the request shape for Choice, Score and Noul; whether several questions over one state batch into one call; latency; pricing and free tier; rate limits; data retention and training-use terms for what is sent; the Python SDK's maturity.
- **Laya and JEV-CPU:** whether they exist as described, licence, the three primitives' interface, CPU latency per question, memory, the size added to a Docker image, and whether any accuracy claim has an independent check.
- **Anything newer** that does typed classification on CPU and should be in the comparison.

Findings go on a `research/` branch; the answer here is the summary and a pointer.

## Answer

Resolved 2026-09-27.
The full note, with every claim tagged primary, secondary or unverified, is on the branch `research/jev-and-lookalikes` at `.scratch/wayfinding/the-form-started-from-a-csv/research/02-jev-and-lookalikes.md`.

**Hosted Jev** (early access since 2026-09-15, model `jev-1.13.0`).

- `POST /v1/systemone` takes one `state` and a map of `questions`; every question over that state is answered in one call, in parallel (TypeSafe's cookbook: 13 questions in 0.27 s batched against 2.71 s separately). One call per column is the natural shape.
- 64K tokens per request, 32K of it for the state plus the longest question.
- $0.042 per million input tokens, output free; 250K tokens/s and 1,200 requests/min, subject to change without notice.
- Latency measured independently at 236-276 ms p50.
- Input is not used for training without consent, but there is **no fixed retention period**, TypeSafe keeps a perpetual right to derive and process "Telemetry" including classifications, and zero data retention is enterprise-only. This bears directly on [01](01-what-hosted-jev-may-be-sent.md).
- Both SDKs are pre-1.0 and two weeks old, with breaking changes already (Python `typesafe-sdk` 0.7.2).

**The local lookalikes are weak.**

- **Laya** is real (Apache 2.0, 193-464 ms per request on CPU, 644-843 MB per checkpoint), but its own README puts the base checkpoints near chance zero-shot: 0.36 against a 0.46 majority baseline, 0.766 only after fine-tuning.
- **JEV-CPU** ships no weights: it reads option logits from stock Qwen3-0.6B, answers Choice only, about 1 s per decision in 3.5 GB of RAM, and its upstream measures 0.440 balanced accuracy at that size.
- CPU torch alone adds 715 MB to an image; Laya about 1.5 GB in all, JEV-CPU about 2.3 GB.

**Better local candidates** for [04](04-does-a-model-beat-the-rules.md): established zero-shot classifiers that run on CPU - MoritzLaurer's `zeroshot-v2.0` NLI models (deberta-v3, 369 MB, MIT), GLiClass (131-606 MB), GLiNER2 (834 MB, benchmarked against Jev).
