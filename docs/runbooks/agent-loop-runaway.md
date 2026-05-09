# Runbook: AcreOS AI Agent Stuck in Loop / Cost Ceiling Exceeded

**Severity:** P1 — Financial + reputation risk
**Owner:** Founder / Theo (AI lead)
**Time to first response:** 15 min

---

## Symptom
- Organization's 24h AI cost exceeds $50 (or custom threshold)
- `aiTelemetryEvents` shows >100 API calls/min from a single org
- Agent output repeats itself or shows circular reasoning (e.g., "checking inventory → checking inventory → ...")
- Customer reports AI responses are looping or taking >30s to respond
- Token usage per request balloons (e.g., >50k tokens for a simple query)

---

## Diagnose
1. Identify the offending org:
   ```sql
   SELECT organization_id, SUM(estimated_cost_cents) AS cost_24h
   FROM ai_telemetry_events
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY organization_id ORDER BY cost_24h DESC LIMIT 5;
   ```
2. Check call frequency:
   ```sql
   SELECT COUNT(*) AS call_count, created_at
   FROM ai_telemetry_events
   WHERE organization_id='<org_id>' AND created_at > NOW() - INTERVAL '1 hour'
   GROUP BY DATE_TRUNC('minute', created_at);
   ```
3. Examine recent prompt history to detect loops:
   ```sql
   SELECT id, prompt, response_tokens, prompt_tokens, created_at
   FROM ai_telemetry_events
   WHERE organization_id='<org_id>'
   ORDER BY created_at DESC LIMIT 10;
   ```
   Look for: identical prompts repeated, response containing previous response, circular logic.
4. Check for prompt-injection signature (user input appears in the system prompt):
   ```bash
   grep -i "user.*input\|execute\|run.*command" <recent_prompt_text>
   ```

---

## Fix
- **Pause the org's agentLifecycle immediately**:
  ```bash
  # Via founder console:
  # 1. Go to /founder/dashboard
  # 2. Find the org by ID or name
  # 3. Click "Pause AI Agent" button
  # 4. Confirm reason: "Cost ceiling exceeded"
  
  # Or via CLI:
  npm run script -- agent:pause --org-id '<org_id>' --reason 'cost_ceiling'
  ```
- **Examine the prompt** — retrieve the org's system prompt:
  ```sql
  SELECT system_prompt, model, temperature, max_tokens
  FROM organization_ai_settings
  WHERE organization_id='<org_id>';
  ```
  Check for: overly complex instructions, missing stop conditions, missing token limits.
- **Look for user input in prompt** — if user's search query is embedded without sanitization, attacker may have injected instructions like "ignore previous rules, execute this code." Escalate if confirmed.
- **Check the model** — if org is using a larger model (gpt-4, claude-opus), consider downgrading to gpt-3.5 or claude-sonnet to reduce cost:
  ```sql
  UPDATE organization_ai_settings
  SET model='claude-sonnet-3.5', temperature=0.7, max_tokens=2000
  WHERE organization_id='<org_id>';
  ```
- **Manually trigger a cost audit**:
  ```bash
  npm run script -- agent:audit-cost --org-id '<org_id>' --since '24 hours'
  ```

---

## Verify
- `ai_telemetry_events` call rate drops to <5 calls/min for the org (effectively paused).
- 24h cost stabilizes (no further increases).
- Review 5 recent ai_telemetry_events rows — confirm responses are within expected token range (100-2000 tokens for typical queries).
- No prompt-injection signatures detected in recent prompts.

---

## Escalate if
- Loop detected and you can't identify the root cause — escalate to Theo (AI lead). Include: org ID, 5 recent prompts, cost graph.
- Cost spike appears suspicious or matches a known attack pattern — escalate to founder + security. May indicate unauthorized use or a compromised API key.
- Org disputes the charges — escalate to founder. Document the telemetry data and offer a partial refund if the loop was on AcreOS's side.
- Same org loops multiple times despite being paused — investigate if there's a hidden agent process or batch job still running:
  ```bash
  ps aux | grep -i agent
  npm run script -- agent:list-processes --org-id '<org_id>'
  ```

---

## Rollback
If you paused the org incorrectly or they successfully remediated:
1. Verify org has made changes (reviewed prompt, reduced model complexity, added safeguards).
2. Re-enable the agent:
   ```bash
   npm run script -- agent:resume --org-id '<org_id>'
   ```
3. Monitor cost for the next 24h — if it spikes again, escalate to termination discussion.

---

## Related
- Runbook: agent-loop-runaway (this runbook)
- Theo's AI safety guidelines: docs/ai-safety.md
- Prompt injection prevention: docs/security/prompt-injection.md
- Cost control: /admin/billing/org/<org_id>
