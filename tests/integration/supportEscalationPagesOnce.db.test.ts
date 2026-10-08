/**
 * One support ticket is ONE hand-off to the founder, and so at most one page —
 * even when two Support runs are working the same ticket at once.
 *
 * Found by the simulation platform's year runs (tests/simulation/platform):
 * the invariant monitor's one-page-per-incident check fired six times in five
 * simulated years, each a second "Support ticket #N needs you: …" page for a
 * ticket the founder had already been paged about. Two Support runs can be
 * briefed on the same waiting ticket (the briefing reads the oldest unassigned
 * ticket and claims nothing), and askFounder's fold is read-then-insert, so
 * two escalations racing both open an ask and both page.
 *
 * The fix makes the hand-off itself the claim: escalate_to_founder moves the
 * ticket to the founder with one conditional UPDATE, and only the run whose
 * UPDATE changed the row asks (and pages). Postgres row locking serialises
 * the two UPDATEs, which is exactly the property a mock cannot show — so this
 * runs on a real database built from this repo.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("supportEscalationPagesOnce.db.test.ts");

describe.runIf(realDbAvailable)("escalating one ticket twice at once pages the founder once", () => {
  const tag = `esc-once-${process.pid}-${Date.now()}`;
  let pool: typeof import("../../server/db").pool;
  let tools: typeof import("../../server/services/solene/roleWorkers/tools");
  let orgId = 0;
  let ticketId = 0;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // The pager pushes to ntfy; nothing leaves the process.
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    ({ pool } = await import("../../server/db"));
    tools = await import("../../server/services/solene/roleWorkers/tools");
    const org = await pool.query<{ id: number }>(
      `INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`,
      [`Escalation test ${tag}`, tag, `${tag}-owner`],
    );
    orgId = org.rows[0].id;
    const t = await pool.query<{ id: number }>(
      `INSERT INTO support_tickets (organization_id, user_id, subject, description, category, status, resolution_type)
       VALUES ($1, $2, $3, $4, 'general', 'open', 'escalated') RETURNING id`,
      [orgId, `${tag}-owner`, `Legal question ${tag}`, "My attorney says your texts broke the TCPA."],
    );
    ticketId = t.rows[0].id;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (!pool) return;
    await pool.query(`DELETE FROM solene_page_events WHERE subject LIKE $1`, [`Support ticket #${ticketId} needs you:%`]);
    await pool.query(`DELETE FROM solene_founder_asks WHERE question_summary LIKE $1`, [`Support ticket #${ticketId} needs you:%`]);
    await pool.query(`DELETE FROM support_tickets WHERE id = $1`, [ticketId]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  });

  it("two concurrent escalations: one ask, one page, the ticket with the founder", async () => {
    const ctx = (d: number) => ({ dispatchId: d, ticketId, organizationId: orgId }) as Parameters<typeof tools.executeRoleTool>[3];
    const input = { ticket_id: ticketId, summary: "Legal matter raised by a customer", why: "legal is the founder's alone" };
    const [a, b] = await Promise.all([
      tools.executeRoleTool("support", "escalate_to_founder", input, ctx(900001)),
      tools.executeRoleTool("support", "escalate_to_founder", input, ctx(900002)),
    ]);
    const asks = await pool.query(`SELECT id FROM solene_founder_asks WHERE question_summary LIKE $1`, [`Support ticket #${ticketId} needs you:%`]);
    const pages = await pool.query(`SELECT id FROM solene_page_events WHERE subject LIKE $1`, [`Support ticket #${ticketId} needs you:%`]);
    const ticket = await pool.query<{ assigned_agent: string | null }>(`SELECT assigned_agent FROM support_tickets WHERE id = $1`, [ticketId]);
    expect(pages.rows.length, `pages for ticket #${ticketId}`).toBe(1);
    expect(asks.rows.length, `asks for ticket #${ticketId}`).toBe(1);
    expect(ticket.rows[0].assigned_agent).toBe(tools.FOUNDER_AGENT);
    // Exactly one run reports the hand-off as its effect; the other is told, in words, that it is already done.
    expect([a, b].filter((r) => r.effect === "escalated").length).toBe(1);
    const other = [a, b].find((r) => r.effect !== "escalated")!;
    expect(other.output).toMatch(/already with the founder/i);
  });

  it("escalating a ticket that is already with the founder neither asks nor pages again", async () => {
    const ctx = { dispatchId: 900003, ticketId, organizationId: orgId } as Parameters<typeof tools.executeRoleTool>[3];
    const r = await tools.executeRoleTool("support", "escalate_to_founder", { ticket_id: ticketId, summary: "Legal matter raised by a customer", why: "again" }, ctx);
    expect(r.effect).toBeUndefined();
    const pages = await pool.query(`SELECT id FROM solene_page_events WHERE subject LIKE $1`, [`Support ticket #${ticketId} needs you:%`]);
    expect(pages.rows.length).toBe(1);
  });
});
