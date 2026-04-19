---
id: pax-conversation-strategy
name: Pax Conversation Strategy
title: Pax Conversation Strategy
goal: Ask Pax (the AI operations copilot) a strategic question and receive a useful, domain-accurate response.
description: Interact with the Pax AI assistant for strategic land investing guidance.
start_url: /
max_steps: 80
timeout_minutes: 20
estimated_duration_minutes: 15
starting_state: Authenticated user on any page with the Pax AI assistant accessible.
success_criteria:
  - User locates and opens the Pax conversational interface (AI Hub or floating assistant)
  - User asks a strategic land investing question in natural language
  - Pax responds with domain-specific, actionable guidance
  - Response references the user's actual portfolio data or CRM state when relevant
  - Response does not hallucinate facts about specific parcels, counties, or legal requirements
  - Conversation supports follow-up questions that build on prior context
success_conditions:
  - Pax interface opens and accepts user input
  - Pax returns a response within 15 seconds
  - Response contains domain-relevant land investing terminology
  - Response is at least 50 words and structured (not a one-liner)
abandonment_criteria:
  - Pax interface fails to load or shows a connection error
  - Response takes more than 20 seconds with no streaming or progress indicator
  - Pax responds with generic AI boilerplate that could apply to any industry
  - Pax hallucinates specific data (e.g., claims a parcel is in a flood zone when no such data exists)
  - Follow-up question gets a response that ignores all prior context
common_failure_modes:
  - OpenRouter API key missing causes Pax to return a configuration error
  - Pax responds with overly cautious disclaimers instead of actionable advice
  - Conversation context window is too short, causing Pax to forget earlier messages
  - Pax references features that do not exist in AcreOS (hallucinated UI elements)
  - Response formatting is broken (raw markdown rendered as plaintext)
---

# Journey Context

Pax is AcreOS's AI operations copilot — a conversational assistant that helps real estate professionals think through strategy, interpret data, and decide what to do next. Unlike the Atlas analysis agent (which evaluates specific parcels), Pax handles broader strategic questions: "Should I target tax-delinquent parcels in this county?" "What's a reasonable offer percentage for 5-acre lots in the Ozarks?" "How do I structure a seller-finance deal with a 10% down payment?"

This journey tests whether Pax delivers genuine value in a conversational interaction. The persona opens the AI Hub or the floating Pax assistant and asks a question that a real estate professional would actually ask — not a trivial lookup, but a question that requires domain knowledge, context awareness, and nuanced judgment.

The persona might ask something like: "I have 200 leads in Mohave County, Arizona. About 40% are tax-delinquent. Should I mail the whole list or focus on the delinquent ones first?" A good Pax response would consider multiple factors: the higher response rate from delinquent owners (they are more motivated to sell), the lower competition for delinquent parcels, the additional due-diligence requirements (tax redemption costs, title clouds), and the persona's stated investment thesis. A bad response would give generic advice like "It depends on your goals" without engaging with the specifics.

The critical quality dimensions are domain accuracy and actionability. Domain accuracy means Pax uses correct terminology, understands land investing workflows, and does not confuse concepts (e.g., confusing "assessed value" with "market value," or suggesting a title insurance step that only applies to residential transactions). Actionability means the response gives the persona something to do next — "Filter your list by years delinquent >= 3, those owners are most likely to sell" — rather than abstract strategic musings.

Context awareness is the differentiator. If the persona has 200 leads in Mohave County, Pax should know that (from the CRM data) and reference it. If Pax responds as if the persona is a generic user with no data, the experience feels hollow. The persona wants to feel like Pax knows their business, not just the land investing industry in general.

The journey also tests follow-up interactions. After the initial response, the persona asks a follow-up: "Okay, what about the non-delinquent ones — should I still mail them or skip this round?" Pax should maintain context from the previous exchange and build on it, not reset and ask "What county are you talking about?"

What "good" looks like: the persona has a 3-5 turn conversation with Pax, each response is substantive and specific, the persona learns something or confirms a strategic hypothesis, and they walk away feeling like they had a productive brainstorming session with a knowledgeable colleague. The persona does not need to fact-check Pax's claims against external sources.

Variations include: the persona asks a question that Pax cannot answer well (e.g., specific legal advice for a state Pax has no training data on), the persona asks about a feature that does not exist yet, or the persona tests Pax's boundaries by asking something off-topic to see how it redirects.
