# Jev and its local lookalikes: what they can do for CSV column classification

Researched 2026-09-27.
Question: can a typed-decision model classify the columns of an organizer's Google Forms responses CSV (essential question or custom field, field type, required, applicant question or organizer note), and what does each candidate cost in latency, money, privacy and image size?
The rules-only baseline is measured elsewhere; this note is facts about the models.

Each claim carries a tag:

- **[primary]** - confirmed against the vendor's own docs, legal pages, repo, package registry or model card, or measured here.
- **[secondary]** - found only in third-party write-ups or community benchmarks.
- **[unverified]** - could not be verified; treat as rumour.

## Headline

- Hosted Jev does what the background notes said, with three corrections: it was announced on 2026-09-15, not 2026-09-19 [primary][^blog]; its context is 64K per request and 32K for the state plus the longest question, not a flat 32K [primary][^models]; and the model is `jev-1.13.0` [primary][^models].
- Jev is not trained on customer input, but the standard contract has no fixed retention period, keeps a perpetual right to derive telemetry (including "classifications") from customer data, and offers zero data retention only to enterprise customers [primary][^privacy][^mca][^legal].
- Laya exists and is Apache 2.0, but its own README says the base checkpoints are "near chance" on typed decisions zero-shot and that it is "a fast base to specialise, not a zero-shot decision engine" [primary][^laya-readme].
- JEV-CPU is not a trained model: it is a script that reads option-letter logits out of stock `Qwen/Qwen3-0.6B`, and its upstream reports 0.440 balanced accuracy for that model size [primary][^jevcpu].
- For a local CPU zero-shot baseline, established NLI zero-shot classifiers (the MoritzLaurer `zeroshot-v2.0` family) and the GLiNER2 / GLiClass family are older, better-trodden and smaller than either lookalike [primary][^hf-api].

## 1. Hosted Jev (TypeSafe AI)

### What it is

- Jev is TypeSafe's "flagship model and the first System One model"; it evaluates typed questions against a state and returns typed answers rather than text [primary][^intro].
- TypeSafe announced it on 2026-09-15 in early access, with developers brought "off the waitlist as quickly as we can" [primary][^blog].
- The weights are closed and there is no self-hosted option; the docs describe only the hosted endpoint, and "the same weights serve every account" [primary][^models].
- Jev is not fine-tuned or LoRA-adapted per customer; domain knowledge goes in the `state`, `instructions` and `criteria` [primary][^models].
- English is the primary training language; other languages are "handled but not equally well" [primary][^models].

### Request shape

- One endpoint: `POST https://api.typesafe.ai/v1/systemone` with a bearer API key [primary][^api].
- The body has `state` (string, object or array), `model` (for example `jev-latest`) and `questions`, a map from an id you choose to a typed question [primary][^api].
- The question id "is not sent to the underlying model and is not used in inference", so the full question must be in `instructions` [primary][^api][^primitives].
- Every question has `type` and `instructions`; `instructions` may be a string, object or array, so reference data can ride beside the question [primary][^api].
- **Noul**: `type: "noul"`, optional `criteria: {true, false}` describing what yes and no mean; the answer is `noul`, a number from 0 to 1 [primary][^api].
- **Choice**: `type: "choice"`, required `criteria` mapping each option key to a description or null, maximum 255 options; the answer is `choice`, a `probabilities` map summing to 1, and `confidence` [primary][^api].
- **Score**: `type: "score"`, required `criteria` as an ordered array of level descriptions, at least two and at most 10; the answer is `score` (a probability-weighted value that can land between levels), `legend`, `probabilities` and `confidence` [primary][^api].
- The response carries `model` (the versioned id that answered, for example `jev-1.13.0`), `answers` keyed by your ids, and `usage` with input and output tokens [primary][^api].
- Errors are 401, 422, 429 (rate limit) and 529 (overloaded) [primary][^api].

### Batching

- Yes: all three question types can be mixed in one call and are evaluated in parallel over one ingestion of the state [primary][^intro][^primitives].
- TypeSafe recommends sending every question that shares a state in one request, and says adding questions "barely changes the response time" [primary][^primitives].
- Their parallel-questions cookbook reports 13 questions in one call at 0.27 s and $0.000497 against 2.71 s and $0.006090 for 13 separate calls [primary, vendor-measured][^cookbook].
- For this use case that means one call per column (state = header plus sample values, questions = essential-or-custom, field type, required, applicant-or-note) or even one call per CSV with per-column question ids, subject to the 64K limit.

### Latency

- TypeSafe claims 70 ms to 500 ms end-to-end and "40x-200x faster" than frontier LLMs on System One tasks [primary, vendor claim][^blog].
- Independent benchmarks measured p50 of 236-256 ms from France [secondary][^abdel] and 264-276 ms median across suites, concluding the numbers "do not support a general 40 to 200 times speed claim" [secondary][^nib].

### Pricing and free tier

- `jev-1.13.0` costs $0.042 per million input tokens ($42 per billion); output tokens are free [primary][^models][^blog].
- The Master Customer Agreement meters usage through prepaid credits and allows discretionary "Promotional Credits" [primary][^mca].
- A $5 starting credit for new accounts, the waitlist being dropped on 2026-09-20, and new signups being paused from 2026-09-22 are reported only by third-party sites [secondary][^free-secondary].
- The console page (`console.typesafe.ai`) was behind a Cloudflare block from this environment, so the live signup state could not be checked [unverified].

### Rate limits

- 250,000 tokens per second and 1,200 requests per minute for `jev-1.13.0`; over either returns 429 [primary][^models].
- The docs warn these limits "can change without notice" while capacity is added, and higher limits need a custom or enterprise plan [primary][^models].

### Data retention and training (vendor PII)

- The Privacy Policy says TypeSafe "will not train or fine tune any artificial intelligence or machine learning models on Input" [primary][^privacy].
- The MCA says TypeSafe will not include customer data in a training dataset "without Customer's prior consent" [primary][^mca].
- The models page repeats that Jev is not trained on customer requests or responses [primary][^models].
- Retention is not time-bounded: the Privacy Policy retains personal data "for as long as reasonably necessary to provide you with the Services, or otherwise in support of our business or commercial purposes" [primary][^privacy].
- The DPA's Schedule I says customer personal data is retained "for as long as necessary taking into account the purpose of the Processing" [primary][^dpa].
- The MCA grants TypeSafe a perpetual licence to use customer data "to derive and generate Telemetry", to monitor fraud and abuse, and to comply with law [primary][^mca].
- Telemetry is defined to include "technical logs, hashes, summary statistics and classifications", which TypeSafe "may Process without restriction, including to improve the Services" [primary][^mca].
- Confidential information "may be retained in TypeSafe's standard backups" after deletion [primary][^mca].
- Zero data retention exists but only "for enterprise customers" via sales [primary][^legal][^models].
- A DPA exists with TypeSafe as processor, EU SCCs and UK Addendum, a subprocessor list at `trust.typesafe.ai`, and 72-hour breach notification [primary][^dpa].
- Inference, not a vendor statement: column classification needs headers and a handful of sample values, not whole rows, so the PII sent can be cut down (for example by sending header text plus value shape summaries), but any real sample value sent falls under the terms above.

### SDK maturity

- Python: `typesafe-sdk` 0.7.2 (2026-09-26), requires Python >=3.10, depends on `httpx2`, `pydantic>=2.12` and `tenacity` [primary][^pypi-ts].
- The first public Python release was 0.5.7 on 2026-09-14, with breaking changes in 0.6.0 (Score criteria shape) and 0.7.0 (msgspec replaced by pydantic) within four days [primary][^py-changelog].
- JavaScript: `@typesafe-ai/sdk` 0.6.0 is `latest` on npm, MIT licensed, first released 2026-09-11 [primary][^npm-ts][^js-changelog].
- Both SDKs retry 429 and 529 with backoff by default [primary][^models][^api].
- The PyPI metadata carries no licence field [primary][^pypi-ts].
- Summary: pre-1.0, two weeks old, with a breaking change roughly every few days so far; pin exact versions.

### Known weaknesses relevant to column classification

- TypeSafe's own "jaggedness" page for `jev-1.13` lists literal reading, unreliable counting and numbers, unreliable date comparison, trouble with indirection, accuracy loss from irrelevant state, susceptibility to adversarial content in the state, and no guaranteed consistency between a Noul and a Choice asking the same thing [primary][^jagged].
- Directly relevant: "is this column a date" is fine as a semantic judgment, but anything like "are all these values valid dates" belongs in code [primary][^jagged].
- Directly relevant: sample values are applicant-written text, and the page says content written to steer the model "can move the answer" [primary][^jagged].
- The alias `jev-latest` moves on release, so thresholds tuned against one version should pin the versioned id [primary][^models].

### Independent accuracy checks of Jev

- AbdelStark's benchmark found a Jev accuracy and Brier advantage over GLiNER2.5 on AG News and Banking77, an unresolved difference on DAIR Emotion, and GLiNER2.5 faster locally on small label sets (~44 ms p50 on an M4 Max CPU) [secondary][^abdel].
- nibzard's benchmark put Jev at 76.3% on a 77-intent banking set (LLMs 70.9% to 81.3%) and 93.0% on spam, and measured 13% pooled answer instability against 37% for a small LLM [secondary][^nib].
- Laya's README cites third-party Jev figures including a top-label ECE of 0.246 and "zero probability to the true label on 16% of examples" on DAIR Emotion [secondary, reported by a competitor][^laya-readme].

## 2. Local lookalikes

### Laya

- Exists: `github.com/NandhaKishorM/laya`, Apache-2.0, created 2026-09-18 [primary][^laya-gh].
- PyPI package `laya` 0.3.20, Python >=3.10, depends on `torch>=2.0`, `transformers>=4.48`, `safetensors`, `huggingface_hub` and `numpy` [primary][^pypi-laya].
- Three checkpoints: `laya` (ModernBERT-large, 421M params, 512 context, English), `laya-multilingual` (mmBERT-base, 322M, 1024 up to 8192) and `laya-typed-decisions` (ModernBERT-large, 421M, fine-tuned) [primary][^laya-readme].
- Interface: same `choice` / `score` / `noul` question types and answer shape as Jev, and `laya[serve]` exposes a Jev-compatible `POST /v1/systemone` [primary][^laya-readme].
- Differences from Jev: options share a 192 to 256 token budget, so beyond about 20 described options they get trimmed; every Score level needs a description; `confidence` is defined differently, so thresholds do not transfer [primary][^laya-readme].
- CPU latency: 193-464 ms per request with preloaded checkpoints; 32.8-39.5 ms on a T4 GPU [primary, author-measured][^laya-readme].
- A community plugin reports about 0.3 s on CPU [secondary][^laya-readme].
- The background note's "~1 s per question on CPU" is not what the Laya README says; that figure belongs to JEV-CPU.
- Cold load: a checkpoint rebuild measured 7.4 s median on CPU [primary, author-measured][^laya-readme].
- Weights: English checkpoint `model.safetensors` is 843 MB, multilingual is 644 MB plus a 34 MB tokenizer; the `convaiinnovations/laya` repo holds all three at about 2.37 GB [primary][^hf-api].
- The "<1 GB" note holds only for one checkpoint, not the default Router, which keeps two resident by default [primary][^laya-readme].
- Accuracy, zero-shot: on its typed-decisions benchmark the base checkpoints score 0.362 and 0.352 against a 0.318 random baseline and a 0.461 majority-class baseline [primary, author-measured][^laya-readme].
- Accuracy, fine-tuned: 0.766 with the checkpoint trained on that benchmark's own training split, against Jev's published 0.727 [primary, author-measured][^laya-readme].
- The README also documents negation failures on CPU (all four negated cancellation requests misclassified on `laya`) and that boolean-word option labels such as `yes` / `no` can be followed instead of their descriptions [primary][^laya-readme].
- No independent accuracy check of Laya was found [unverified].
- The repo shows about 25,900 stars and 2,250 forks nine days after creation, which is unusual and not evidence of quality either way [primary][^laya-gh].

### JEV-CPU

- Exists: `huggingface.co/Meanblock/JEV-CPU` (MIT, created 2026-09-19, base model `Qwen/Qwen3-0.6B`) and mirror `github.com/leesk212/JEV-CPU` (MIT) [primary][^hf-api][^jevcpu].
- It ships no weights of its own (the Hugging Face repo is about 33 MB of code, benchmarks and demo assets); it downloads stock `Qwen/Qwen3-0.6B` (Apache-2.0, 1.5 GB safetensors) on first run [primary][^hf-api].
- It is a CPU port of SemIf (formerly OpenJev, `TheoLeeCJ/SemIf-OpenJev`, MIT), swapping only the loader to CPU float32 [primary][^jevcpu].
- Mechanism: each option gets a letter, the prompt asks for only the letter, one forward pass reads the logits of the letter tokens and softmaxes over them [primary][^jevcpu].
- Interface: Choice only; its HTTP API is `POST /api/decide` with `state` and a list of `criteria`, each with options; there is no Score or Noul and no Jev wire compatibility [primary][^jevcpu].
- It is not a pip package; setup is `pip install torch` (CPU index), `transformers`, `accelerate`, then running `semif_cpu.py` or `server.py` from the repo [primary][^jevcpu].
- CPU latency: about 1 s per decision for short states, 2.5 s at 254 input tokens, 11.9 s at 1,363 tokens, 117 s at 7,697 tokens [primary, author-measured][^jevcpu].
- Memory: ~2.4 GB for the float32 model, ~3.5 GB peak RAM, flat with input length; model load 5 to 17 s [primary, author-measured][^jevcpu].
- Accuracy: SemIf's own evaluation gives Qwen3-0.6B 0.440 authored balanced accuracy and 0.407 TypeSafe-subset agreement, against 0.813 and 0.845 for Qwen3.5-4B [primary, upstream-measured][^jevcpu].
- No independent accuracy check was found [unverified].

### Docker image cost (both)

- `torch 2.14.0+cpu` for CPython 3.11 on x86_64 is a 196 MB wheel that unpacks to 715 MB [primary, measured here].
- Laya adds `transformers` and friends plus 843 MB (English) or 678 MB (multilingual) of weights if baked in, so roughly 1.5 to 1.7 GB on top of the current back-end image, or ~0.8 GB if weights are fetched at runtime instead [primary for parts, sum is an estimate].
- JEV-CPU adds torch, `transformers`, `accelerate` and 1.5 GB of Qwen3-0.6B weights, so roughly 2.3 GB, and needs ~3.5 GB of RAM at run time [estimate from primary parts].
- `transformers` and its dependencies were not measured here [unverified].

### Larger lookalikes

- The unofficial site `jevtypesafeai.com` (operated by CODEFASHION TECH LTD, "Not affiliated with or endorsed by TypeSafe AI") lists OpenJev (24 GB+ VRAM), APUS-OpenJev GGUF (4B / 9B), NanoJev (GPU) and others [secondary][^jevlocal].
- None of these was checked further, since they need a GPU and the back end runs on CPU.

## 3. Established CPU zero-shot classifiers worth comparing

- **NLI zero-shot classifiers** (MoritzLaurer `deberta-v3-base-zeroshot-v2.0`, 369 MB, MIT; `-large-` 870 MB; `bge-m3-zeroshot-v2.0`, 1.1 GB, multilingual) run through the standard `transformers` `zero-shot-classification` pipeline, one entailment pass per label, and ship ONNX exports [primary][^hf-api].
- They map naturally to Choice (one hypothesis per option) and Noul (one hypothesis), but have no ordered Score and no probability calibration claim.
- **GLiClass** (`knowledgator/gliclass-edge-v3.0`, 131 MB; `gliclass-modern-base-v3.0`, 606 MB; both Apache-2.0) scores all labels in one pass [primary][^hf-api].
- **GLiNER2** (`fastino/gliner2-base-v1`, 834 MB, Apache-2.0, updated 2026-09-24) does classification plus structured extraction and is the local baseline AbdelStark benchmarked against Jev, at about 44 ms p50 on an M4 Max CPU for small label sets [primary for the model card metadata][^hf-api]; [secondary for the benchmark][^abdel].
- `facebook/bart-large-mnli` (1.6 GB, MIT) is the long-standing default of the zero-shot pipeline, larger and older than the options above [primary][^hf-api].
- Their accuracy on this particular task (column headers plus sample values) is unknown and would need to be measured against the rules-only baseline [unverified].

## Sources

[^intro]: TypeSafe docs, Introduction, https://docs.typesafe.ai/introduction (index at https://docs.typesafe.ai/llms.txt).
[^api]: TypeSafe docs, API reference, https://docs.typesafe.ai/api.md
[^models]: TypeSafe docs, Models, https://docs.typesafe.ai/models.md
[^primitives]: TypeSafe docs, Primitives, https://docs.typesafe.ai/primitives.md
[^cookbook]: TypeSafe docs, Parallel questions cookbook, https://docs.typesafe.ai/cookbooks/parallel_questions.md
[^jagged]: TypeSafe docs, Jev 1.13 jaggedness (reviewed 2026-09-17), https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
[^legal]: TypeSafe docs, Legal, https://docs.typesafe.ai/legal.md
[^privacy]: TypeSafe Privacy Policy, https://typesafe.ai/legal/privacy-policy
[^mca]: TypeSafe Master Customer Agreement, sections 4.1, 4.3, 8.2 and termination, https://typesafe.ai/legal/mca
[^dpa]: TypeSafe Data Processing Addendum (updated 2026-04-24), https://typesafe.ai/legal/data-processing
[^blog]: TypeSafe blog, "Introducing System One Models & Jev" (2026-09-15), https://typesafe.ai/blog/introducing-system-one-models-and-jev
[^pypi-ts]: PyPI JSON for `typesafe-sdk`, https://pypi.org/pypi/typesafe-sdk/json
[^py-changelog]: TypeSafe Python SDK changelog, https://docs.typesafe.ai/sdk/python/changelog.md
[^npm-ts]: npm registry for `@typesafe-ai/sdk`, https://registry.npmjs.org/@typesafe-ai/sdk
[^js-changelog]: TypeSafe JavaScript SDK changelog, https://docs.typesafe.ai/sdk/javascript/changelog.md
[^free-secondary]: Third-party reports of the $5 credit and signup status, for example https://flaviocopes.com/jev-api-key/ and https://explainx.ai/blog/jev-general-availability-no-waitlist-2026
[^abdel]: AbdelStark, jev-benchmarks (Apache-2.0), https://github.com/AbdelStark/jev-benchmarks
[^nib]: nibzard, decision-model-benchmark, https://github.com/nibzard/decision-model-benchmark
[^laya-gh]: GitHub repository metadata, https://github.com/NandhaKishorM/laya
[^laya-readme]: Laya README and BENCHMARKS.md at `main` as of 2026-09-27, https://github.com/NandhaKishorM/laya
[^pypi-laya]: PyPI JSON for `laya`, https://pypi.org/pypi/laya/json
[^jevcpu]: JEV-CPU model card, https://huggingface.co/Meanblock/JEV-CPU , and https://github.com/leesk212/JEV-CPU ; upstream https://github.com/TheoLeeCJ/SemIf-OpenJev
[^hf-api]: Hugging Face model API (licence, file sizes, dates) for `convaiinnovations/laya`, `convaiinnovations/laya-multilingual`, `Meanblock/JEV-CPU`, `Qwen/Qwen3-0.6B`, `MoritzLaurer/deberta-v3-base-zeroshot-v2.0`, `MoritzLaurer/deberta-v3-large-zeroshot-v2.0`, `MoritzLaurer/bge-m3-zeroshot-v2.0`, `knowledgator/gliclass-edge-v3.0`, `knowledgator/gliclass-modern-base-v3.0`, `fastino/gliner2-base-v1`, `facebook/bart-large-mnli`, via https://huggingface.co/api/models/<repo>?blobs=true
[^jevlocal]: Unofficial site, https://www.jevtypesafeai.com/jev/local
