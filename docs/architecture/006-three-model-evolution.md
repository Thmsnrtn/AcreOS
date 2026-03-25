# ADR-006: Three-Model Adversarial Evolution Pipeline

## Context

The platform evolution system generates improvements to prompts, scoring algorithms, and agent behavior. Using a single AI model for self-improvement creates blind spots — the model can't identify its own systematic biases or failure modes.

## Decision

The evolution pipeline uses three models (Claude, GPT-4, DeepSeek) in an adversarial review pattern. One model proposes a change, the other two review and critique it. A change must pass 2-of-3 approval to be accepted. A circuit breaker halts the pipeline if 3 consecutive proposals are rejected or if a deployed change degrades measured outcomes.

## Consequences

**Positive:** Adversarial review catches single-model blind spots — each model has different biases and failure modes. Three-model consensus produces more robust improvements. The circuit breaker prevents runaway self-modification. All proposals, reviews, and decisions are logged for auditability.

**Negative:** Three-model pipeline costs 3x per evolution cycle. Latency is higher (sequential review). Model disagreements can stall evolution if the models have fundamentally different "opinions." Requires API keys for three providers, increasing infrastructure complexity.
