# ADR 008: OpenAI as Primary AI Provider

**Status**: Accepted
**Date**: 2025-01-10
**Deciders**: Engineering team

## Context

AcreOS integrates AI capabilities throughout the platform: property valuation, lead scoring, negotiation assistance, deal hunting, market analysis, and the Atlas AI assistant. We need to select an AI provider and define a resilience strategy.

## Decision

We use **OpenAI GPT-4o** as the primary model for reasoning-intensive tasks and **GPT-4o-mini** for cost-efficient high-volume tasks. The integration uses the OpenAI Node.js SDK with streaming support.

**Key AI features using OpenAI:**
- Atlas AI assistant (deal-aware chatbot)
- Negotiation orchestrator (6-round strategy generation)
- Deal Hunter automated lead sourcing
- AVM narrative generation
- Marketing copy generation

**Resilience strategy:**
- Prompt injection guard (`server/middleware/promptInjection.ts`) blocks 15 known attack patterns
- Graceful degradation: all AI endpoints return user-friendly errors when OpenAI is unavailable
- AI conversation history is scoped per organization (no cross-tenant leakage)
- Rate limiting on all `/api/ai/*` routes to prevent cascade failures and cost overruns

## Rationale

| Concern | OpenAI GPT-4 | Anthropic Claude | Open-source (Llama) |
|---|---|---|---|
| **Capability** | Excellent | Excellent | Good |
| **API reliability** | Excellent | Excellent | Self-hosted complexity |
| **Streaming** | SSE/WebSocket | SSE | Varies |
| **Tool use / function calling** | Mature | Mature | Limited |
| **Cost** | Moderate | Moderate | Infra cost |
| **Ecosystem** | Largest | Growing | Limited |

OpenAI was selected for its mature tool-use ecosystem, largest third-party library support, and proven reliability at scale.

## Consequences

- API key must be rotated 24h before launch
- Daily cost alerting configured for spend threshold exceeded
- Fallback behavior: UI shows loading state and clear error when API is unavailable
- No PII should be included in prompts (enforced in service layer)
- AI memory/conversation data is stored in organization-scoped tables
