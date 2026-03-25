# ADR-005: Voice Learning for AI Output

## Context

AI-generated content (offer letters, campaign copy, negotiation suggestions, agent communications) needs to sound like it was written by the user, not by a language model. Generic AI output is immediately recognizable and damages trust with sellers, buyers, and business partners.

## Decision

All AI output passes through a voice learning system that matches the user's communication style. The system analyzes the user's previous messages (emails, campaign text, notes) to build a style profile — vocabulary preferences, sentence structure, formality level, common phrases, and tone. This profile is injected into AI prompts as style guidance, and output is validated against the profile before delivery.

## Consequences

**Positive:** AI output is indistinguishable from what the user would write themselves. This creates a genuine competitive moat — the style profile improves with every message, creating switching costs. Users trust the AI more because it sounds like them, leading to higher adoption of AI features. Offer letters and campaign copy perform better because they feel authentic.

**Negative:** Style learning requires a minimum volume of user messages before it's effective (~20 messages). Cold-start users get generic but professional output until the system has enough data. The style profile must be excluded from cross-org data sharing. Prompt length increases by ~200 tokens per request for style context.
