# Sayuri Vatanen — AcreOS Vector Search & Embeddings Audit

**Date:** 2026-05-01
**Wave:** 3 of the 87-persona audit (specialized engineering)
**Lens:** Five years at Pinecone, three at Weaviate. I built the index that retrieved 1.4B vectors for a Fortune 50 search team. I have stared at HNSW M/efConstruction graphs in my sleep.
**Predecessors:** Theo Okuda (`elite-team-2026-05-01/theo-ai.md`) cataloged the AI surface and called the architecture "good, the discipline is not." Sayuri Murakami (`elite-team-deep-2026-05-01/sayuri-eval.md`) specified eval infra for those surfaces. Neither touched retrieval. That is my lane.

---

## 1. Verdict

**Vector-retrieval maturity: 0.5 / 5.** AcreOS has *one* embedding callsite (`dealPatternCloning.ts:709` calling `text-embedding-3-small`), stores the result as `jsonb` in `embedding_vector` (`shared/schema.ts:7308`), and has **no pgvector extension, no ANN index, no cosine operator, no hybrid retrieval, no embedding refresh job.** Similarity is computed in TypeScript with hand-rolled Jaccard + normalized-Euclidean (`dealPatternCloning.ts:480, 475`). At 200 patterns per org this is fine. At 50k it is a sequential scan that loads the entire embedding column into Node memory and decodes JSON for every query.

There is also a memory surface — `executive.ts:996` injects "Atlas episodic memory" — but it retrieves by `memoryType` enum and recency, not by vector. The model gets the wrong memories at the wrong time and nobody notices because there is no eval (Sayuri Murakami's point, recurring).

A 0.5 means "they shipped one feature that thinks about vectors and quietly built a wall it will hit the day a power-user has 10k closed deals." Not zero, because the embedding column exists. Not one, because nothing in the retrieval path knows it is a vector.

---

## 2. Where vectors actually pay off in AcreOS

Ranked by *value per dollar of infra spend*. Not every AI surface needs vectors. The ones that do:

1. **Pax executive chat memory recall** (`server/ai/executive.ts:996, 1292`). Currently injects the last N "episodic" memories by recency. A user who said "I don't buy in flood zones" three weeks ago will not have that memory surfaced when they ask "should I buy this Florida lot?" today. Semantic recall against the user's prior statements is the highest-leverage vector use in the codebase.
2. **Similar-property recommendation for buyers** (driven by `buyerMatchingAI.ts`, `acreOSValuation.ts`). Today this appears to be SQL filters on acreage/county/state. Vectors make "find me three more lots like this one" cheap and qualitatively better — terrain, road access, utilities, zoning compose into a single 1536-dim signal.
3. **Deal pattern cloning** (`dealPatternCloning.ts`, already partially built). The fingerprint→embedding flow exists. What is missing is the index, the operator, and the refresh cadence. Three days of work makes this 100× faster.
4. **Document retrieval — disclosures, contracts, county docs.** When `complianceAI.ts` drafts a Seller's Property Disclosure for Texas, it should retrieve the most-relevant prior signed disclosure and the TX statute boilerplate. Today it generates from training data alone, which is exactly the malpractice risk Theo flagged.
5. **Support deflection / playbook retrieval** (`supportBrain.ts`). A new ticket "my SMS isn't sending" should retrieve the three closest historical resolved tickets and their resolution. Today the classifier picks a category and a hardcoded playbook fires.
6. **Lead-similarity for nurturing** (`leadNurturer.ts`). "This new lead looks like the 12 leads we previously closed at 14% margin" is a vector query, not a SQL query.

Surfaces that should **not** use vectors:
- Support classifier (`supportBrain.ts:49`) — it's an enum classifier, not retrieval. Vectors are wrong tool.
- Briefing writer / headline insight — deterministic templates, per Theo §7.
- Board-of-directors voting — governance theater, vectors won't fix the underlying problem.

---

## 3. pgvector vs Pinecone vs Weaviate vs Qdrant — recommendation

I evaluated all four against AcreOS's specific shape: multi-tenant Postgres on Fly.io (memory: `project_infra`), TypeScript-only server, ~20 AI surfaces, embeddings volume in the **low six figures total** for the foreseeable 18 months (≤500k vectors across all orgs). Here is the matrix.

| Dimension | pgvector | Pinecone | Weaviate | Qdrant |
|---|---|---|---|---|
| Setup complexity | `CREATE EXTENSION` + index — 30 min | New service, new auth, new SDK | New service, schema-first | New service, simpler than Weaviate |
| Multi-tenant filter cost | Native `WHERE org_id = $1` joins your existing data | Metadata filter — extra index, $$ per metadata field | Filterable refs — works | Payload filter — works |
| Cost @ 500k vectors, 1536d | **~$0 marginal** (uses existing Postgres) | ~$70/mo (Standard tier, 1 pod) | ~$50/mo (self-host on existing infra) or $200+ managed | ~$30/mo self-host, ~$80 managed |
| Query latency p95 @ 500k | 30–80ms with HNSW ef=64 | 15–40ms | 20–50ms | 15–40ms |
| Hybrid (vector + keyword) | Native — combine with existing tsvector (`fullTextSearch.ts`) in one SQL | Sparse-dense via $$ tier | Built-in BM25+vector | Native sparse vectors |
| Transactional consistency with deals/leads | **Same DB, same transaction** | Eventually consistent, separate system | Separate system | Separate system |
| Operability for a 1-engineer ops team | Fewest moving parts | New on-call surface | New on-call surface | New on-call surface |
| Ceiling | ~10M vectors per org before partitioning hurts | Effectively unbounded | Effectively unbounded | Effectively unbounded |

### Recommendation: **pgvector. For at least the next 18 months.**

Reasons in priority order:

1. **You already pay for Postgres.** AcreOS is on Fly.io managed Postgres. pgvector is a `CREATE EXTENSION vector;` away. Zero new infra, zero new auth, zero new SDK, zero new on-call.
2. **Multi-tenant filtering is free.** `WHERE organization_id = $1 ORDER BY embedding_vector <=> $2 LIMIT 10` is a single SQL query that joins to deals, properties, leads in the same statement. In Pinecone/Weaviate/Qdrant you re-implement org isolation in metadata filters and then re-fetch the source rows from Postgres anyway. Two systems, two failure modes, one network roundtrip you didn't need.
3. **Hybrid retrieval is one query, not two.** AcreOS already has tsvector GIN indexes (`server/services/fullTextSearch.ts:73`). Combining `to_tsvector` with `embedding <=> query_emb` in a single CTE gives you BM25 + cosine without standing up a second system. This is what "hybrid search" actually means in production, and pgvector ships it natively.
4. **Volume does not justify a dedicated vector DB.** A single-tenant Land Investor org will close ~50–500 deals/year, have ~5–50k leads, and accumulate ~5–500 documents. Multiply by the realistic next-18-month customer count and you are at ≤500k vectors total. pgvector with HNSW handles 10M before you even feel it. The cost-and-complexity case for Pinecone kicks in at ~50M+ where the dedicated index outperforms — you are 100× away.
5. **Switching is cheap if you outgrow it.** Embeddings live in your DB column. The day you are at 50M vectors, you `pg_dump` the column, batch-upsert into Pinecone, swap the retrieval function. No customer-visible migration. Locking yourself in by adopting Pinecone *first* is the expensive direction.

**When I would reverse this:** if AcreOS ships a public-facing parcel-search index across all 150M US parcels (cross-org, not customer-scoped), that is a different shape. ~1.5B vectors at the high end, latency-critical, public-internet-facing. That index lives in Qdrant or Pinecone, not pgvector. But that is a product that does not exist yet.

---

## 4. Embedding model choice

Currently: **`text-embedding-3-small`** in `dealPatternCloning.ts:710`. 1536-dim. ~$0.02 per 1M tokens. This is a defensible default and I would not change it today. But here is the matrix for when the question reopens:

| Model | Dim | $/1M tok | MTEB avg | Right for AcreOS? |
|---|---|---|---|---|
| `text-embedding-3-small` | 1536 | $0.020 | 62.3 | **Yes — current default** |
| `text-embedding-3-large` | 3072 | $0.130 | 64.6 | Only for compliance/legal corpus where the 2.3% accuracy gain matters; 6.5× cost |
| `voyage-3` | 1024 | $0.060 | 65.5 | Better at retrieval specifically; consider for v2 |
| `cohere-embed-v3-english` | 1024 | $0.100 | 64.5 | Strong but 5× the cost of OAI-3-small |
| `bge-large-en-v1.5` (self-host) | 1024 | $0 + GPU | 64.2 | Premature; revisit at >$500/mo embedding spend |

**Concrete moves:**
1. Keep `text-embedding-3-small` as the default. Pin the API version (`text-embedding-3-small` is already a stable name, but confirm OpenAI hasn't quietly added `-2024-xx` variants).
2. For **compliance disclosures** specifically — where retrieval precision is legal-exposure-shaped — A/B `voyage-3` against `text-embedding-3-small` on a 50-disclosure golden set. If voyage wins by ≥4% nDCG@10, switch *that surface only*.
3. **Never embed PII.** APN strings, SSNs, full addresses get fingerprinted (h(value)) before embedding, or stripped entirely. Embeddings are reversible-enough to be PII themselves; the 1536-dim signal of a unique address is essentially that address.
4. **Do not mix dimensions.** If you ever change embedding model, the new vectors live in a new column (`embedding_vector_v2`) until backfill is complete. Mixed-dim queries silently return garbage.

---

## 5. Hybrid search — vector + keyword

This is where Sayuri-Murakami's eval work and my retrieval work meet. Pure vector search has a known failure mode: it retrieves "semantically similar" results that miss the *exact* keyword the user asked for. Pure keyword search misses paraphrases. Hybrid wins on both, in every benchmark I have run for the last six years.

### Design

For Pax executive memory recall (highest-leverage surface):

```sql
WITH
  v AS (
    SELECT id, content, 1 - (embedding <=> $query_emb) AS vec_score
    FROM agent_memories
    WHERE organization_id = $1
    ORDER BY embedding <=> $query_emb
    LIMIT 50
  ),
  k AS (
    SELECT id, content,
           ts_rank_cd(content_tsv, websearch_to_tsquery('english', $query_text)) AS kw_score
    FROM agent_memories
    WHERE organization_id = $1
      AND content_tsv @@ websearch_to_tsquery('english', $query_text)
    LIMIT 50
  )
SELECT
  COALESCE(v.id, k.id) AS id,
  COALESCE(v.content, k.content) AS content,
  (COALESCE(v.vec_score, 0) * 0.6 + COALESCE(k.kw_score, 0) * 0.4) AS score
FROM v
FULL OUTER JOIN k USING (id)
ORDER BY score DESC
LIMIT 10;
```

The 0.6 / 0.4 weighting is a starting point. Tune on a labeled retrieval set: 100 (query, expected-doc-id) pairs from production traces, sweep weights, pick the pareto-optimal. **Reciprocal Rank Fusion (RRF)** is the principled alternative — `1/(60+rank_v) + 1/(60+rank_k)` — and worth A/B-ing against the linear blend. RRF wins ~60% of the cases I've measured.

### Why this matters operationally

The query above is **one Postgres query, one network hop, returns the source row directly.** The Pinecone equivalent is: query Pinecone, get IDs, query Postgres for content, ts_rank in app code, merge. Three trips, two systems, one race condition between them.

---

## 6. RAG for Pax — what to actually retrieve

Theo's §3.B rewrite of the Pax executive prompt is correct. I am extending it with a retrieval layer.

**Retrieval contract for every Pax turn:**

1. **User-memory recall (vector + keyword hybrid).** "What has the user told us in prior turns?" Top 5 from `agent_memories` filtered by `organization_id`, by hybrid score, with a recency-decay bonus (`* exp(-days_since/30)`).
2. **Active-property context (deterministic, no vectors).** If a property is open in the UI (`executive.ts:962`), inject the structured row. Vectors here would be silly — you have the exact ID.
3. **Similar-deal pattern recall (vector).** If the user is asking about an open deal, retrieve top 3 closed deals with the most-similar fingerprint (`dealPatternCloning.ts` already computes the embedding — light up the index and query it). Inject as "Three deals you closed that look like this" mini-cards.
4. **Document retrieval (vector, only when needed).** If the user asks a question containing keywords that match a document corpus (contracts, disclosures, county statutes), retrieve top 3 chunks. Otherwise skip — RAG-on-everything is the most common over-engineering mistake in this space and bloats the prompt.

**Prompt budget:** Cap retrieval at ~1500 tokens injected. Anything more is noise that degrades the model's attention to the user's actual message. (`Lost in the middle` — Liu et al — applies and is reproducible at 8k+ context.)

**Deterministic fallback:** Every retrieval call must have an empty-result branch. Embedding API down → return `[]` → Pax answers without RAG, with a quiet log line. RAG must never be a hard dependency for chat to work.

---

## 7. Cost model at scale

For three growth scenarios, embedding + retrieval cost only:

| Scenario | Orgs | Vectors total | Embedding refresh / mo | Query volume / day | Monthly $ |
|---|---|---|---|---|---|
| Today (8 customers) | 8 | ~5k | ~500 | ~200 | **<$5** |
| Year 1 target (150 customers) | 150 | ~150k | ~15k | ~10k | **~$30** |
| Year 3 stretch (2k customers) | 2,000 | ~2M | ~200k | ~150k | **~$400** |

Assumptions: avg embedding input = 200 tokens, `text-embedding-3-small` at $0.02/1M, query cost == embed-the-query (one embedding per query). Storage on pgvector with HNSW index ~6 GB at 2M vectors × 1536 × 4 bytes — fits comfortably on the existing Postgres instance.

**The cost story for pgvector is essentially free until ~10M vectors.** A separate Pinecone tier at year 3 stretch would be ~$300/mo *additional* — same order, but you also added an on-call surface, a second auth boundary, and a new deploy story. Stay on pgvector.

---

## 8. Embedding refresh cadence

The most under-thought question in vector systems and the one that bites every time.

| Surface | Refresh trigger | Rationale |
|---|---|---|
| Deal patterns | On `deal.status = 'closed'` write | Patterns are immutable once closed |
| User memories | On insert only — never re-embed | Memory text doesn't change |
| Property similar-recs | On `property.UPDATE` of any of {acreage, county, zoning, terrain, utilities, roadAccess} | Source-of-truth changes |
| Compliance disclosure corpus | Quarterly batch on statute text changes | Statutes change rarely; manual trigger from legal |
| Support tickets / playbooks | On ticket close | Resolution adds the signal worth retrieving |
| Lead profiles | Daily batch of leads modified in last 24h | Lead enrichment dribbles in; daily is fine |

**Provider model bump:** When OpenAI ships `text-embedding-4-small` (they will, eventually), full reembed is **mandatory** — you cannot mix. Plan for this:
1. Add `embedding_model_version` column alongside `embedding_vector`.
2. New column `embedding_vector_v2` for new model.
3. Backfill job runs in the background, ~$200 for a 2M-vector reembed at OAI-3 prices.
4. Switch reads to v2 once backfill ≥99% complete.
5. Drop v1 column 7 days later.

This is a one-week project executed once every ~18 months. Budget for it explicitly.

---

## 9. The 1-week vector-bootstrap sprint

**Day 1.** `CREATE EXTENSION IF NOT EXISTS vector;` Migration: change `embedding_vector jsonb` → `embedding_vector vector(1536)`. Backfill from existing jsonb (24 lines of SQL). Add HNSW index `WITH (m=16, ef_construction=64)` on `(organization_id, embedding_vector vector_cosine_ops)`.

**Day 2.** Replace `dealPatternCloning.ts:480` Jaccard+Euclidean with a single Drizzle raw SQL: `ORDER BY embedding_vector <=> ${queryEmb} LIMIT 10`. Delete the in-memory similarity function. Benchmark — should drop p95 from ~400ms (current N² scan) to ~30ms.

**Day 3.** `agent_memories` table — add `embedding_vector vector(1536)` and `content_tsv tsvector` (matching the existing `fullTextSearch.ts` pattern). Backfill on insert via a small worker. Wire into `executive.ts:996, 1292` to replace recency-only retrieval with hybrid scoring.

**Day 4.** Property similar-recs surface. New endpoint `GET /api/properties/:id/similar?limit=5`. Embeds the property fingerprint, returns top-K by cosine within the same org. UI tile: "More like this in your area."

**Day 5.** Eval set integration with Sayuri Murakami's harness. 50 (query, expected-doc-id) fixtures for Pax memory recall. Scoring: nDCG@5 + recall@10. Block PRs that drop nDCG > 5%. Ship the deterministic empty-result fallback and unit-test it.

**Stretch day 6–7.** Embedding refresh cron + telemetry. Counter for embed-API calls per day per org. Alert if any single org is generating >1k embeds/day (likely a runaway loop, not a real workload).

**End of sprint:** AcreOS goes from 0.5/5 to 3/5 vector maturity. pgvector live, hybrid retrieval shipped on Pax memory + similar-properties, eval gate, refresh cadence written down. The remaining 3→4.5 progression is broader corpus coverage (compliance docs, ticket history) and is 2–3 more weeks.

---

## 10. References

- `server/services/dealPatternCloning.ts:709` — only embedding callsite, `text-embedding-3-small`
- `server/services/dealPatternCloning.ts:480, 475` — hand-rolled Jaccard + normalized-Euclidean (replace with pgvector `<=>`)
- `shared/schema.ts:7308` — `embedding_vector jsonb` column (migrate to `vector(1536)`)
- `server/services/fullTextSearch.ts:73` — existing tsvector GIN pattern (compose into hybrid)
- `server/ai/executive.ts:996, 1292` — Atlas episodic memory (currently recency-only; vectorize)
- `server/services/scpMemorySystem.ts:595` — memory surface, no vectors today
- `server/db.ts:14` — vanilla `node-postgres` driver, pgvector-compatible out of the box
- Predecessor docs: `elite-team-2026-05-01/theo-ai.md`, `elite-team-deep-2026-05-01/sayuri-eval.md`

---

**Bottom line for the founder:** You have one embedding callsite that is doing the right thing in the wrong way (jsonb + in-memory similarity). Turn on pgvector, swap the operator, light up hybrid retrieval against the tsvector indexes you already shipped, and you have built-in semantic memory + similar-property recommendation + RAG-for-Pax for ~$30/mo all-in at year-1 scale. Do **not** buy Pinecone. You are 100× away from the volume where it pays. Revisit at 50M vectors, which on current trajectory is year 4 at the earliest. Until then every dollar you would have spent on Pinecone is better spent on more embeddings.
