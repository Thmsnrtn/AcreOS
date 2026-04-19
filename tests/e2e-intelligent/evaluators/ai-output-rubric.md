# AI Output Rubric

Rules for evaluating the quality of AI-generated content (Atlas and Pax responses) encountered during a journey. Each evaluation produces an `AIQualityFinding` as defined in `src/harness/types.ts`.

## When to Evaluate

An AI output evaluation is triggered whenever the persona encounters AI-generated text during a journey. This includes: Atlas parcel analysis results, Pax conversational responses, AI-generated due diligence checklists, automated valuation estimates, and any other content produced by an LLM within AcreOS. Each evaluation is tied to a specific step number and records the full output text, the context in which it appeared, and the five-dimension scoring below.

## The Five Scoring Dimensions

Each dimension is scored 1-5. Anchor descriptions define what each score means concretely.

### 1. Domain Accuracy (domainAccuracy)

Does the output reflect correct knowledge of land investing, real estate, and county-specific details?

| Score | Anchor |
|---|---|
| 5 | All facts correct. County-specific details (assessment ratios, zoning codes, local providers) are accurate. Math checks out. |
| 4 | Facts correct with minor omissions. One county-specific detail missing but nothing wrong. |
| 3 | Mostly correct but contains one factual error that an experienced investor would catch (e.g., wrong assessment ratio, incorrect legal instrument for the state). |
| 2 | Multiple factual errors or a single critical error (e.g., treating assessed value as market value, ignoring landlocked status). |
| 1 | Fundamentally wrong. Advice would cause financial harm if followed. |

### 2. Actionability (actionability)

Can the persona act on this output without additional research?

| Score | Anchor |
|---|---|
| 5 | Specific next steps with costs, timelines, responsible parties, and contact points. Persona can execute immediately. |
| 4 | Clear next steps but missing one detail (e.g., cost estimate or timeline). Persona needs one phone call to proceed. |
| 3 | General direction is clear but steps are vague. "Check with the county" without specifying which office or what to ask. |
| 2 | Output reads as informational but does not tell the persona what to do. Useful as background, not as a workflow. |
| 1 | No actionable content. Generic statements like "do your due diligence" or "consult a professional." |

### 3. Appropriate Caution (appropriateCaution)

Does the output flag risks, unknowns, and limitations? Does it hedge where data is uncertain without being so cautious that it becomes useless?

| Score | Anchor |
|---|---|
| 5 | All material risks flagged (access, title, flood, zoning, mineral rights -- whichever apply). Unknowns explicitly stated. Hedging is proportional to actual uncertainty. |
| 4 | Major risks flagged but one secondary risk omitted. Appropriate hedging. |
| 3 | Some risks mentioned but presented as minor when they are material, or excessive hedging that makes the output hard to use ("I can't really say anything definitive"). |
| 2 | Key risk missing entirely (e.g., no mention of landlocked status, flood zone, or tax lien exposure). |
| 1 | No risk flags at all. Output presents a recommendation with false confidence. Or so hedged that it conveys zero information. |

### 4. Signal to Noise (signalToNoise)

Is the output concise and focused, or padded with filler?

| Score | Anchor |
|---|---|
| 5 | Every sentence contributes information. Structured clearly (headings, bullet points, numbered steps). No boilerplate. |
| 4 | Mostly signal. One or two filler sentences that do not add value but do not distract. |
| 3 | Mixed. Useful information is buried in generic preamble or repeated in different words. Persona has to work to extract the value. |
| 2 | More noise than signal. Extensive boilerplate, disclaimers repeated multiple times, or off-topic content. |
| 1 | Almost entirely filler. "That's a great question! Let me help you with that." followed by generic advice. |

### 5. Credibility (credibility)

Would a real estate professional with 5+ years of experience trust this output? This is the holistic gut-check dimension.

| Score | Anchor |
|---|---|
| 5 | Output reads like it was written by someone who has closed 50+ land deals. Specific comps cited, math shown, vocabulary precise. |
| 4 | Reads as competent. An experienced investor would trust the output but might verify one detail. |
| 3 | Plausible but generic. Could have been written by someone who read a blog post about land investing. Not wrong, but not convincing. |
| 2 | Contains tells that erode trust: round numbers without derivation, misused terminology, generic advice dressed up as analysis. |
| 1 | Immediately dismissed by anyone with domain knowledge. See `knowledge/red-flags-in-analysis.md` for concrete examples. |

## Overall Verdict

Computed from the average of all five dimension scores:

| Verdict | Average Score | Meaning |
|---|---|---|
| **CREDIBLE** | 4.0 or higher | Output meets the standard expected of a professional-grade AI tool. |
| **QUESTIONABLE** | 2.5 to 3.9 | Output has value but contains enough issues that trust is conditional. The persona proceeds with reservations. |
| **NOT_CREDIBLE** | Below 2.5 | Output would be rejected by the target user. If this appears on a core flow, the journey outcome cannot be COMPLETED_SATISFIED. |

## Reference Material

For concrete examples of credible vs. non-credible AI output across 15 land-investing scenarios, see `knowledge/red-flags-in-analysis.md`. That document also contains a 10-point credibility marker checklist (specificity, math shown, risks flagged, sources cited, uncertainty expressed, actionable next steps, state/county specifics, vocabulary accuracy, strategy alignment, deal math integration). An output hitting 8+ of 10 markers maps to CREDIBLE. An output missing 4+ maps to NOT_CREDIBLE.
