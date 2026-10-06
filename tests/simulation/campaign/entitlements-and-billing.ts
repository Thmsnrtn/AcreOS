/**
 * Entitlements & billing sim — does the product charge, limit and permit
 * EXACTLY what it says?
 *
 * The documented contract lives in three places and this sim treats each as
 * a hypothesis to be falsified against the running server + the database:
 *
 *   - shared/billing/tier-limits.ts     (the walls: leads/properties/notes/campaigns per tier)
 *   - server/services/usageLimits.ts    (what the meter counts; soft-deleted + sample rows excluded)
 *   - server/utils/permissions.ts       (what each role may do; viewer read-only; va assigned-only)
 *
 * plus the three posture gates chained from getOrCreateOrg (pause → dunning →
 * viewer read-only), the Stripe webhook verifier, the credit ledger and the
 * per-user export quota.
 *
 * Every scenario records metrics; behaviour that differs from the contract is
 * a finding; a step that cannot run is a skip with its reason — never green.
 *
 *   DATABASE_URL=postgresql://acreos:acreos@localhost:5432/acreos_sim \
 *   SIM_BASE_URL=http://localhost:5000 \
 *   npx tsx tests/simulation/campaign/entitlements-and-billing.ts
 */
import pg from "pg";
import { SimClient, type Resp } from "./client";
import { recordFinding, recordMetric, recordSkip, type Severity } from "./ledger";
import { personaTestUserId } from "../../../server/auth/testAuth";
import { TIER_LIMITS } from "../../../shared/billing/tier-limits";

const SIM = "entitlements-and-billing";
const RUN = Date.now().toString(36);
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://acreos:acreos@localhost:5432/acreos_sim",
});

// ───────────────────────────── ledger helpers ─────────────────────────────

function finding(id: string, sev: Severity, area: string, title: string, evidence: string, impact?: string, repro?: string) {
  recordFinding({ sim: SIM, id: `A-ENT-${id}`, product: "AcreOS", sev, area, title, evidence, impact, repro });
}
function skip(step: string, reason: string) {
  recordSkip({ sim: SIM, step, reason });
}
function metric(name: string, value: unknown) {
  recordMetric(SIM, name, value);
}
function short(r: Resp, n = 220) {
  return `${r.status} ${r.text.slice(0, n).replace(/\s+/g, " ")}`;
}

// ───────────────────────────── persona + DB helpers ─────────────────────────────

interface Persona {
  c: SimClient;
  slug: string;
  clerkId: string;
  userId: string;
  email: string;
  orgId: number | null;
}

/** Insert a users row (what Clerk would have created) and, by default, let getOrCreateOrg provision the org. */
async function freshPersona(tag: string, opts?: { email?: string; provision?: boolean }): Promise<Persona> {
  const slug = `ent-${tag}-${RUN}`;
  const clerkId = personaTestUserId(slug);
  const email = (opts?.email ?? `${clerkId}@ent-sim.local`).toLowerCase();
  const r = await db.query(
    `INSERT INTO users (clerk_user_id, email) VALUES ($1, $2)
     ON CONFLICT (clerk_user_id) DO NOTHING RETURNING id`,
    [clerkId, email],
  );
  const userId: string = r.rows[0].id;
  const c = new SimClient(slug);
  let orgId: number | null = null;
  if (opts?.provision !== false) {
    // /api/auth/user is isAuthenticated-only; /api/organization runs getOrCreateOrg and provisions the org.
    const me = await c.get("/api/organization");
    if (me.status !== 200) throw new Error(`persona ${slug}: GET /api/organization → ${short(me)}`);
    orgId = await orgOwnedBy(userId);
    if (!orgId) throw new Error(`persona ${slug}: no org provisioned`);
  }
  return { c, slug, clerkId, userId, email, orgId };
}

async function orgOwnedBy(userId: string): Promise<number | null> {
  const r = await db.query(`SELECT id FROM organizations WHERE owner_id = $1 ORDER BY id LIMIT 1`, [userId]);
  return r.rows[0]?.id ?? null;
}

async function orgRow(orgId: number) {
  const r = await db.query(
    `SELECT id, subscription_tier, subscription_status, subscription_paused, subscription_pause_ends_at,
            dunning_stage, trial_started_at, trial_ends_at, trial_used, credit_balance::int AS credit_balance,
            seat_count, settings, is_founder
       FROM organizations WHERE id = $1`,
    [orgId],
  );
  return r.rows[0];
}

async function setOrg(orgId: number, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const updSql = 'UPDATE organizations SET ' + sets + ' WHERE id = $1'; // dynamic column list
  await db.query(updSql, [orgId, ...keys.map((k) => patch[k])]);
}

/** Mirror of usageLimits.ts counting rules, straight from SQL. */
async function dbCounts(orgId: number) {
  const q = async (sql: string) => (await db.query(sql, [orgId])).rows[0].n as number;
  return {
    leads: await q(`SELECT count(*)::int AS n FROM leads WHERE organization_id=$1 AND deleted_at IS NULL AND coalesce(source,'') NOT IN ('sample_data','sample')`),
    leadsIncludingDeleted: await q(`SELECT count(*)::int AS n FROM leads WHERE organization_id=$1 AND coalesce(source,'') NOT IN ('sample_data','sample')`),
    properties: await q(`SELECT count(*)::int AS n FROM properties WHERE organization_id=$1 AND coalesce(apn,'') NOT LIKE 'SAMPLE-%' AND status <> 'deleted'`),
    notes: await q(`SELECT count(*)::int AS n FROM notes n WHERE organization_id=$1 AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = n.property_id AND p.apn LIKE 'SAMPLE-%')`),
    campaigns: await q(`SELECT count(*)::int AS n FROM campaigns WHERE organization_id=$1`),
  };
}

function leadBody(tag: string, i: number, extra: Record<string, unknown> = {}) {
  const local = tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    firstName: "Ent",
    lastName: `${tag} ${i}`,
    email: `ent.${local}.${i}.${RUN}@example.com`,
    county: "Cochise",
    state: "AZ",
    ...extra,
  };
}
const propertyBody = (i: number) => ({ apn: `ENT-${RUN}-${i}`, county: "Cochise", state: "AZ", sizeAcres: "10" });
const noteBody = (i: number) => ({
  originalPrincipal: "50000",
  interestRate: "8",
  termMonths: 120,
  startDate: "2026-10-01",
  firstPaymentDate: "2026-11-01",
  notes: `ent note ${i}`,
});
const campaignBody = (i: number) => ({
  name: `Ent campaign ${i} ${RUN}`,
  type: "email",
  subject: "A note about your land",
  content: "Hi {{firstName}}, we buy land in {{county}}.",
  status: "draft",
});

/**
 * POST `mk(i)` to `path` until the first 429 (the wall) or `limit + 1` calls.
 * Any status that is neither 2xx nor 429 is captured as "other" (3 max) and
 * stops the loop so a broken body never masquerades as a wall.
 */
async function fillToWall(c: SimClient, path: string, mk: (i: number) => unknown, limit: number, label: string) {
  const ids: number[] = [];
  let created = 0;
  let wall: { i: number; r: Resp } | null = null;
  const other: Array<{ i: number; status: number; body: string }> = [];
  for (let i = 1; i <= limit + 1; i++) {
    const r = await c.post(path, mk(i));
    if (r.status === 201 || r.status === 200) {
      created++;
      if (typeof r.body?.id === "number") ids.push(r.body.id);
      continue;
    }
    if (r.status === 429) {
      wall = { i, r };
      break;
    }
    other.push({ i, status: r.status, body: r.text.slice(0, 200) });
    if (other.length >= 3) break;
  }
  const wallBody = wall?.r.body ?? null;
  const hasUpsell = !!wallBody && /upgrade|nextTier|upgradeUrl/i.test(wall!.r.text);
  metric(`wall:${label}`, { limit, created, wallAt: wall?.i ?? null, wallStatus: wall?.r.status ?? null, hasUpsell, wallBody: wall?.r.text.slice(0, 300) ?? null, other });
  return { created, ids, wallAt: wall?.i ?? null, wall: wall?.r ?? null, hasUpsell, other };
}

/** Compare the two usage endpoints against the DB. Returns the usage body. */
async function auditMeter(c: SimClient, orgId: number, label: string, idPrefix: string) {
  const counts = await dbCounts(orgId);
  const usage = await c.get("/api/usage");
  const status = await c.get("/api/usage/status");
  const fromUsage = (k: string) => usage.body?.usage?.[k]?.current;
  const fromStatus = (k: string) => (status.body?.limits as Array<any> | undefined)?.find((l) => l.resource === k)?.current;
  const rows = (["leads", "properties", "notes", "campaigns"] as const).map((k) => ({
    resource: k,
    db: counts[k],
    usage: fromUsage(k),
    status: fromStatus(k),
    limitClaimed: usage.body?.usage?.[k]?.limit,
  }));
  metric(`meter:${label}`, { tier: usage.body?.tier, rows, usageStatus: usage.status, statusStatus: status.status });
  for (const row of rows) {
    if (usage.status === 200 && row.usage !== row.db) {
      finding(`${idPrefix}-usage-${row.resource}`, "P2", "billing-meter",
        `The meter lies: GET /api/usage reports ${row.resource}.current=${row.usage} but the DB holds ${row.db} countable rows (${label})`,
        `org ${orgId}; GET /api/usage → ${JSON.stringify(usage.body?.usage?.[row.resource])}; DB count (same rule as usageLimits.ts) = ${row.db}`,
        "The number the customer sees next to the wall is not the number the wall enforces.");
    }
    if (status.status === 200 && row.status !== undefined && row.status !== row.db) {
      finding(`${idPrefix}-status-${row.resource}`, "P2", "billing-meter",
        `GET /api/usage/status reports ${row.resource} current=${row.status}, DB holds ${row.db} (${label})`,
        `org ${orgId}; /api/usage/status entry ${JSON.stringify((status.body?.limits as any[])?.find((l) => l.resource === row.resource))}`);
    }
    if (status.status === 200 && row.status === undefined) {
      // /api/usage/status deliberately labels four resources; campaigns rides through unlabeled. Record, do not judge.
      metric(`meter:${label}:status-missing`, row.resource);
    }
  }
  return { usage: usage.body, status: status.body, counts };
}

// ═══════════════════════════════ 1. FREE-TIER WALLS ═══════════════════════════════

async function scenarioFreeWalls() {
  console.log(`\n[${SIM}] 1. free-tier walls`);
  const p = await freshPersona("free");
  const orgId = p.orgId!;
  const org = await orgRow(orgId);
  metric("free:org", { orgId, tier: org.subscription_tier, status: org.subscription_status, trialEndsAt: org.trial_ends_at });
  if (org.subscription_tier !== "free") {
    skip("free-walls", `fresh org provisioned as tier '${org.subscription_tier}', not free`);
    return p;
  }
  const L = TIER_LIMITS.free;

  // leads 50 → 51st
  const leads = await fillToWall(p.c, "/api/leads", (i) => leadBody("free", i), L.leads!, "free/leads");
  const dbLeads = (await dbCounts(orgId)).leads;
  if (leads.created !== L.leads || leads.wallAt !== L.leads! + 1) {
    finding("1-leads-wall", "P1", "tier-limits",
      `Free lead wall is not at ${L.leads}: ${leads.created} created, wall at call #${leads.wallAt ?? "none"}`,
      `other=${JSON.stringify(leads.other)}; wall=${leads.wall ? short(leads.wall) : "none"}`);
  }
  if (dbLeads !== leads.created) {
    finding("1-leads-db", "P1", "data-integrity", `Created ${leads.created} leads via API but DB counts ${dbLeads}`, `org ${orgId}`);
  }
  if (leads.wall && !leads.hasUpsell) {
    finding("1-leads-upsell", "UX", "tier-limits", "Lead-limit 429 carries no upsell (no nextTier/upgradeUrl in body)", short(leads.wall));
  }
  if (leads.wall) metric("free:leads-429-shape", leads.wall.body);
  if (leads.wall && /faster than the system|wait a few seconds/i.test(leads.wall.body?.message ?? "")) {
    finding("1-wall-copy", "UX", "tier-limits",
      "A plan limit is worded as a throttling error: the lead-wall 429 message says \"You're sending requests faster than the system can handle. Wait a few seconds and try again.\"",
      `POST /api/leads #51 → ${short(leads.wall, 260)}`,
      "Waiting will not help — the org is at its plan limit. The truthful upsell lives only in `details` (nextTier/upgradeUrl) while the human-readable message and docsUrl (/help/article/rate-limit) describe a different condition. Same shape on notes, campaigns and the email-credit wall.",
      "create 51 leads on a free org; read the 429 body's `message`");
  }

  // properties 3 → 4th
  const props = await fillToWall(p.c, "/api/properties", propertyBody, L.properties!, "free/properties");
  if (props.created !== L.properties || props.wallAt !== L.properties! + 1) {
    finding("1-props-wall", "P1", "tier-limits",
      `Free property wall is not at ${L.properties}: ${props.created} created, wall at #${props.wallAt ?? "none"}`,
      `other=${JSON.stringify(props.other)}; wall=${props.wall ? short(props.wall) : "none"}`);
  } else if (!props.hasUpsell) {
    finding("1-props-upsell", "UX", "tier-limits",
      "Property-limit 429 names no next tier / upgrade URL (POST /api/properties uses the inline 429, not usageLimitGate's upsell shape)",
      short(props.wall!), "The lead wall sells the upgrade; the property wall just says no. Same customer, two different walls.");
  }

  // notes 2 → 3rd
  const notes = await fillToWall(p.c, "/api/notes", noteBody, L.notes!, "free/notes");
  if (notes.other.length && notes.created === 0) {
    skip("free-walls/notes", `POST /api/notes never returned 201: ${JSON.stringify(notes.other[0])}`);
  } else if (notes.created !== L.notes || notes.wallAt !== L.notes! + 1) {
    finding("1-notes-wall", "P1", "tier-limits",
      `Free note wall is not at ${L.notes}: ${notes.created} created, wall at #${notes.wallAt ?? "none"}`,
      `other=${JSON.stringify(notes.other)}; wall=${notes.wall ? short(notes.wall) : "none"}`);
  } else if (!notes.hasUpsell) {
    finding("1-notes-upsell", "UX", "tier-limits", "Note-limit 429 names no next tier / upgrade URL", short(notes.wall!));
  }

  // campaigns 0 → first refused
  const camp = await p.c.post("/api/campaigns", campaignBody(1));
  metric("free:campaign-first", short(camp));
  if (camp.status !== 429) {
    finding("1-campaign-wall", "P1", "tier-limits",
      `Free tier (campaigns: 0) accepted a campaign create with ${camp.status}`, short(camp));
  }

  // the meter vs the DB
  await auditMeter(p.c, orgId, "free/at-wall", "1");

  // soft delete 5 → does the meter drop? does the wall open?
  const victims = leads.ids.slice(0, 5);
  const delStatuses: number[] = [];
  for (const id of victims) delStatuses.push((await p.c.delete(`/api/leads/${id}`)).status);
  metric("free:delete-5", delStatuses);
  const afterDel = await auditMeter(p.c, orgId, "free/after-delete-5", "1d");
  const usageAfterDel = afterDel.usage?.usage?.leads?.current;
  const dropped = usageAfterDel === leads.created - victims.length;
  metric("free:soft-deleted-counts-against-limit", { usageAfterDel, expectedIfExcluded: leads.created - 5, dropped });
  const extra = await p.c.post("/api/leads", leadBody("free-after-del", 1));
  metric("free:create-after-delete", short(extra));
  if (!dropped || extra.status !== 201) {
    finding("1-soft-delete-counts", "UX", "tier-limits",
      "Soft-deleted leads still count against the free limit: the customer cannot see them but cannot add a lead either",
      `usage after deleting 5 of ${leads.created}: ${usageAfterDel}; POST /api/leads → ${short(extra)}`,
      "A wall built from rows the customer cannot see is a wall they cannot reason about.");
  }
  // restore the 5 → does the org sit above its limit?
  const restoreStatuses: number[] = [];
  for (const id of victims) restoreStatuses.push((await p.c.patch(`/api/leads/${id}/restore`)).status);
  const afterRestore = await auditMeter(p.c, orgId, "free/after-restore-5", "1r");
  const list = await p.c.get("/api/leads?pageSize=100");
  const overByRestore = await p.c.post("/api/leads", leadBody("free-after-restore", 1));
  metric("free:restore-5", { restoreStatuses, usageAfterRestore: afterRestore.usage?.usage?.leads?.current, listTotal: list.body?.total, nextCreate: short(overByRestore) });
  if ((afterRestore.usage?.usage?.leads?.current ?? 0) > L.leads!) {
    metric("free:observation", `PATCH /api/leads/:id/restore has no usage gate — org now holds ${afterRestore.usage?.usage?.leads?.current}/${L.leads} and the next create is refused (${overByRestore.status}). Product observation, not judged.`);
  }
  if (list.status === 200 && typeof list.body?.total === "number" && list.body.total !== afterRestore.counts.leads) {
    finding("1-list-vs-meter", "P2", "billing-meter",
      `GET /api/leads total=${list.body.total} disagrees with the countable DB rows (${afterRestore.counts.leads})`, short(list, 120));
  }
  return p;
}

// ═══════════════════════════════ 2. TIER CHANGE + POSTURE GATES ═══════════════════════════════

async function scenarioTierChange(p: Persona) {
  console.log(`\n[${SIM}] 2. tier change + posture gates`);
  const orgId = p.orgId!;

  // starter
  await setOrg(orgId, { subscription_tier: "starter" });
  const S = TIER_LIMITS.starter;
  const before = (await dbCounts(orgId)).leads;
  const room = S.leads! - before;
  const leads = await fillToWall(p.c, "/api/leads", (i) => leadBody("starter", i), room, "starter/leads");
  if (leads.created !== room || leads.wallAt !== room + 1) {
    finding("2-starter-leads", "P1", "tier-limits",
      `Starter lead wall not at ${S.leads}: had ${before}, created ${leads.created} more (expected ${room}), wall at #${leads.wallAt ?? "none"}`,
      `other=${JSON.stringify(leads.other)}; wall=${leads.wall ? short(leads.wall) : "none"}`);
  }
  const camps = await fillToWall(p.c, "/api/campaigns", campaignBody, S.campaigns!, "starter/campaigns");
  if (camps.created !== S.campaigns || camps.wallAt !== S.campaigns! + 1) {
    finding("2-starter-campaigns", "P1", "tier-limits",
      `Starter campaign wall not at ${S.campaigns}: ${camps.created} created, wall at #${camps.wallAt ?? "none"}`,
      `other=${JSON.stringify(camps.other)}; wall=${camps.wall ? short(camps.wall) : "none"}`);
  }
  await auditMeter(p.c, orgId, "starter/at-wall", "2s");

  // pro
  await setOrg(orgId, { subscription_tier: "pro" });
  const proLead = await p.c.post("/api/leads", leadBody("pro", 1));
  const proCamp = await p.c.post("/api/campaigns", campaignBody(99));
  metric("pro:first-past-starter-wall", { lead: short(proLead, 80), campaign: short(proCamp, 80) });
  if (proLead.status !== 201) finding("2-pro-lead", "P1", "tier-limits", `Pro org refused lead #${S.leads! + 1} (pro limit ${TIER_LIMITS.pro.leads})`, short(proLead));
  if (proCamp.status !== 201) finding("2-pro-campaign", "P1", "tier-limits", `Pro org (campaigns unlimited) refused campaign #${S.campaigns! + 1}`, short(proCamp));

  // paused: the gate reads subscription_paused + pause_ends_at (orgOperating.pauseInForce)
  const probe = async (label: string) => {
    const w = await p.c.post("/api/leads", leadBody(label, 1));
    const u = await p.c.put(`/api/leads/${leads.ids[0]}`, { notes: label });
    const r = await p.c.get("/api/leads?pageSize=1");
    const usage = await p.c.get("/api/usage");
    const out = { write: short(w, 160), update: short(u, 100), read: r.status, usage: usage.status };
    metric(`gate:${label}`, out);
    return { w, u, r, usage };
  };
  await setOrg(orgId, { subscription_status: "paused" });
  const statusOnly = await probe("status=paused-only");
  if (statusOnly.w.status === 201) {
    metric("gate:observation", "subscription_status='paused' alone does NOT engage subscriptionPauseGate (it keys on subscription_paused/pause_ends_at); background jobs via orgActRefusal would refuse the same org as 'subscription_inactive'. Recorded, not judged — the column the dialog writes is subscription_paused.");
  }
  await setOrg(orgId, { subscription_paused: true, subscription_pause_ends_at: new Date(Date.now() + 30 * 86400e3) });
  const paused = await probe("paused");
  if (paused.w.status !== 402 || paused.u.status !== 402) {
    finding("2-pause-mutation", "P1", "posture-gates", `Paused org mutation was not refused with 402`, `POST ${short(paused.w)}; PUT ${short(paused.u)}`);
  } else if (paused.w.body?.error !== "subscription_paused") {
    finding("2-pause-shape", "P3", "posture-gates", "Pause 402 body lacks error='subscription_paused' the banner keys on", short(paused.w));
  }
  if (paused.r.status !== 200 || paused.usage.status !== 200) {
    finding("2-pause-read", "P1", "posture-gates", "Paused org lost READ access (pause is documented as read-only, not no-access)", `GET /api/leads → ${paused.r.status}; GET /api/usage → ${paused.usage.status}`);
  }
  await setOrg(orgId, { subscription_paused: false, subscription_pause_ends_at: null, subscription_status: "active" });

  // dunning: only 'restricted' gates (DUNNING_STAGES.restricted.accessLevel='limited')
  await setOrg(orgId, { dunning_stage: "restricted" });
  const dunned = await probe("dunning=restricted");
  if (dunned.w.status !== 402 || dunned.u.status !== 402) {
    finding("2-dunning-mutation", "P1", "posture-gates", "dunning_stage='restricted' did not refuse mutations with 402", `POST ${short(dunned.w)}; PUT ${short(dunned.u)}`);
  } else if (dunned.w.body?.details?.reason !== "dunning_restricted" && dunned.w.body?.reason !== "dunning_restricted") {
    finding("2-dunning-shape", "P3", "posture-gates", "Dunning 402 body lacks reason='dunning_restricted'", short(dunned.w));
  }
  if (dunned.r.status !== 200) finding("2-dunning-read", "P1", "posture-gates", "Restricted (dunning) org lost READ access", `GET /api/leads → ${dunned.r.status}`);
  await setOrg(orgId, { dunning_stage: "suspended" });
  const suspended = await probe("dunning=suspended");
  metric("gate:observation-suspended", `dunning_stage='suspended' (accessLevel 'none' in DUNNING_STAGES): POST /api/leads → ${suspended.w.status}. The gate deliberately passes it (day-15 downgrade handles it); recorded as the documented-vs-table gap.`);
  await setOrg(orgId, { dunning_stage: "none" });
  const restored = await probe("restored");
  if (restored.w.status !== 201) finding("2-restore", "P1", "posture-gates", "After restoring status/pause/dunning the org still cannot write", short(restored.w));
}

// ═══════════════════════════════ 3. TRIAL SEMANTICS ═══════════════════════════════

async function scenarioTrial() {
  console.log(`\n[${SIM}] 3. trial semantics`);
  const p = await freshPersona("trial");
  const orgId = p.orgId!;
  const org = await orgRow(orgId);
  const endsAt = org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : null;
  const daysOut = endsAt ? (endsAt - Date.now()) / 86400e3 : null;
  const status = await p.c.get("/api/trial/status");
  const me = await p.c.get("/api/auth/user");
  metric("trial:fresh", { dbStatus: org.subscription_status, dbTier: org.subscription_tier, trialEndsAt: org.trial_ends_at, daysOut: daysOut?.toFixed(2), api: status.body, authUserTrialFields: Object.fromEntries(Object.entries(me.body ?? {}).filter(([k]) => /trial/i.test(k))) });
  if (daysOut === null || daysOut < 13.9 || daysOut > 14.1) {
    finding("3-trial-length", "P2", "trial", `Fresh org trial_ends_at is ${daysOut?.toFixed(2) ?? "null"} days out, not 14`, JSON.stringify({ trialEndsAt: org.trial_ends_at }));
  }
  if (status.status === 200) {
    const apiEnds = status.body?.trialEndsAt ? new Date(status.body.trialEndsAt).getTime() : null;
    if (apiEnds !== endsAt) {
      finding("3-trial-ends-mismatch", "P2", "trial", "/api/trial/status.trialEndsAt differs from organizations.trial_ends_at", `api=${status.body?.trialEndsAt} db=${org.trial_ends_at}`);
    }
    if (daysOut && daysOut > 13 && (status.body?.isTrialing !== true || status.body?.daysRemaining === 0)) {
      finding("3-trial-status-lies", "P2", "trial",
        `A fresh org has 14 trial days in the DB but /api/trial/status says isTrialing=${status.body?.isTrialing}, daysRemaining=${status.body?.daysRemaining}`,
        `org ${orgId}: subscription_status='${org.subscription_status}', trial_ends_at=${org.trial_ends_at}; getTrialStatus requires subscription_status==='trialing' while getOrCreateOrg provisions 'active'`,
        "The landing page promises 14 days free; the only trial endpoint tells the same customer they are not on a trial.");
    }
  } else {
    skip("trial/status", `GET /api/trial/status → ${short(status)}`);
  }

  // expire it
  await setOrg(orgId, { trial_ends_at: new Date(Date.now() - 86400e3) });
  const w = await p.c.post("/api/leads", leadBody("trial-expired", 1));
  const r = await p.c.get("/api/leads?pageSize=1");
  const s2 = await p.c.get("/api/trial/status");
  const usage = await p.c.get("/api/usage");
  metric("trial:expired", { write: short(w, 80), read: r.status, status: s2.body, usageTier: usage.body?.tier, leadLimit: usage.body?.usage?.leads?.limit });
  if (w.status !== 201 || r.status !== 200) {
    finding("3-trial-expired-gates", "P2", "trial", "Expiring the trial on a FREE org changed read/write access (free is a permanent tier; nothing should close)", `POST ${short(w)}; GET ${r.status}`);
  }
  if (usage.body?.usage?.leads?.limit !== TIER_LIMITS.free.leads) {
    finding("3-trial-expired-limits", "P2", "trial", "Expired trial changed the free lead limit", JSON.stringify(usage.body?.usage?.leads));
  }
  await setOrg(orgId, { trial_ends_at: org.trial_ends_at });
}

// ═══════════════════════════════ 4. ROLES ═══════════════════════════════

type Role = "owner" | "admin" | "member" | "viewer" | "va";
const ROLE_LIST: Role[] = ["owner", "admin", "member", "viewer", "va"];

/** The documented contract, transcribed from server/utils/permissions.ts ROLE_PERMISSIONS (keys the matrix exercises). */
const DOC: Record<Role, Record<string, boolean>> = {
  owner: { canCreateLeads: true, canEditLeads: true, canDeleteLeads: true, canImportData: true, canExportData: true, canCreateCampaign: true, canManageTeam: true, canAccessSettings: true, canManageBilling: true, canAssignLeads: true, viewOnlyAssignedLeads: false },
  admin: { canCreateLeads: true, canEditLeads: true, canDeleteLeads: true, canImportData: true, canExportData: true, canCreateCampaign: true, canManageTeam: true, canAccessSettings: true, canManageBilling: false, canAssignLeads: true, viewOnlyAssignedLeads: false },
  member: { canCreateLeads: true, canEditLeads: true, canDeleteLeads: false, canImportData: false, canExportData: false, canCreateCampaign: false, canManageTeam: false, canAccessSettings: false, canManageBilling: false, canAssignLeads: false, viewOnlyAssignedLeads: false },
  va: { canCreateLeads: true, canEditLeads: true, canDeleteLeads: false, canImportData: false, canExportData: false, canCreateCampaign: false, canManageTeam: false, canAccessSettings: false, canManageBilling: false, canAssignLeads: false, viewOnlyAssignedLeads: true },
  viewer: { canCreateLeads: false, canEditLeads: false, canDeleteLeads: false, canImportData: false, canExportData: false, canCreateCampaign: false, canManageTeam: false, canAccessSettings: false, canManageBilling: false, canAssignLeads: false, viewOnlyAssignedLeads: true },
};

interface MatrixRow { role: Role; action: string; claimed: boolean | string; actual: number; expectedOk: boolean; ok: boolean; note?: string }
const MATRIX: MatrixRow[] = [];

async function scenarioRoles() {
  console.log(`\n[${SIM}] 4. roles`);
  const owner = await freshPersona("roles-owner");
  const orgId = owner.orgId!;
  // pro: 5 seats max; owner + 4 invitees = 5 → seat_count must cover the projection
  await setOrg(orgId, { subscription_tier: "pro", seat_count: 5 });

  // invite one of each role
  const members: Partial<Record<Role, Persona>> = { owner };
  for (const role of ["admin", "member", "viewer", "va"] as Role[]) {
    const email = `ent-${role}-${RUN}@ent-sim.local`;
    const inv = await owner.c.post("/api/organization/invitations", { email, role });
    metric(`roles:invite:${role}`, short(inv, 120));
    const token = inv.body?.invitations?.[0]?.token;
    if (inv.status !== 201 || !token) {
      skip(`roles/invite-${role}`, `POST /api/organization/invitations → ${short(inv)}`);
      continue;
    }
    // the invitee signs in for the first time via the invite link: accept BEFORE any org-provisioning call
    const invitee = await freshPersona(`roles-${role}`, { email, provision: false });
    const acc = await invitee.c.post("/api/organization/invitations/accept", { token });
    metric(`roles:accept:${role}`, short(acc, 120));
    if (acc.status >= 300) {
      skip(`roles/accept-${role}`, `accept → ${short(acc)}`);
      continue;
    }
    invitee.c.setCookie("acreos_active_org", String(orgId));
    invitee.orgId = orgId;
    members[role] = invitee;
  }

  const tm = await db.query(`SELECT id, user_id, role, view_only_assigned_leads, is_active FROM team_members WHERE organization_id=$1 ORDER BY id`, [orgId]);
  metric("roles:team_members", tm.rows);
  const tmOf = (p: Persona) => tm.rows.find((r) => r.user_id === p.userId);

  // the VA's per-user flag: invite-accept inserts team_members without viewOnlyAssignedLeads; the column is NOT NULL DEFAULT false,
  // and getUserPermissionContext lets an explicit boolean on the row override the role default (true for va).
  const vaRow = members.va ? tmOf(members.va) : null;
  metric("roles:va-row", vaRow);

  // matrix
  const founderProbe: Record<string, number> = {};
  for (const role of ROLE_LIST) {
    const p = members[role];
    if (!p) { skip(`roles/matrix-${role}`, "no accepted persona for this role"); continue; }
    const perms = await p.c.get("/api/me/permissions");
    if (perms.status !== 200) {
      skip(`roles/matrix-${role}`, `GET /api/me/permissions → ${short(perms)}`);
      continue;
    }
    const claimed: Record<string, boolean> = perms.body.permissions ?? {};
    metric(`roles:claims:${role}`, { role: perms.body.role, claims: claimed });
    if (perms.body.role !== role) {
      finding(`4-role-${role}`, "P1", "roles", `Persona invited as '${role}' is reported as '${perms.body.role}' by /api/me/permissions`, short(perms, 200));
    }
    for (const [k, v] of Object.entries(DOC[role])) {
      if (claimed[k] !== v) {
        finding(`4-claim-drift-${role}-${k}`, "P1", "roles",
          `/api/me/permissions claims ${k}=${claimed[k]} for ${role}; permissions.ts documents ${v}`,
          `org ${orgId}; team_members row ${JSON.stringify(tmOf(p))}`,
          k === "viewOnlyAssignedLeads" && role === "va"
            ? "The invite-accept path inserts the team_members row without viewOnlyAssignedLeads; the NOT NULL DEFAULT false column then OVERRIDES the va role default (true) in getUserPermissionContext — a VA invited the normal way sees the whole pool."
            : undefined);
      }
    }

    // fresh owner-made, unassigned leads for this role's probes
    const mk = async (tag: string) => {
      const r = await owner.c.post("/api/leads", leadBody(`roles-${role}-${tag}`, 1));
      return r.body?.id as number;
    };
    const editId = await mk("edit");
    const delId = await mk("del");

    const row = (action: string, permKey: string, r: Resp, okCodes: number[], extraExpect?: boolean, note?: string) => {
      const expectedOk = extraExpect ?? claimed[permKey] === true;
      const actualOk = okCodes.includes(r.status);
      const entry: MatrixRow = { role, action, claimed: claimed[permKey] ?? "n/a", actual: r.status, expectedOk, ok: actualOk === expectedOk, note };
      MATRIX.push(entry);
      if (!entry.ok) {
        finding(`4-${role}-${action.replace(/\W+/g, "-")}`, "P1", "roles",
          `${role}: /api/me/permissions claims ${permKey}=${claimed[permKey]} but ${action} returned ${r.status} (${actualOk ? "allowed" : "refused"})`,
          `${short(r, 200)}${note ? ` — ${note}` : ""}`, "The product tells the customer one thing about this seat and enforces another.");
      }
      return r;
    };

    row("create lead", "canCreateLeads", await p.c.post("/api/leads", leadBody(`roles-${role}-create`, 1)), [201]);
    const editExpected = claimed.canEditLeads === true && claimed.viewOnlyAssignedLeads !== true;
    row("edit unassigned lead", "canEditLeads", await p.c.put(`/api/leads/${editId}`, { notes: `edited by ${role}` }), [200], editExpected,
      claimed.viewOnlyAssignedLeads ? "assigned-only caller editing an unassigned lead → expected refusal" : undefined);
    const delExpected = claimed.canDeleteLeads === true && claimed.viewOnlyAssignedLeads !== true;
    row("delete lead", "canDeleteLeads", await p.c.delete(`/api/leads/${delId}`), [204], delExpected);
    row("csv-import 1 row", "canImportData", await p.c.post("/api/leads/csv-import", { rows: [{ firstName: "Csv", lastName: `${role} ${RUN}`, apn: `CSV-${role}-${RUN}`, state: "AZ", county: "Cochise" }] }), [200, 201]);
    row("export leads", "canExportData", await p.c.get("/api/leads/export"), [200]);
    row("create campaign", "canCreateCampaign", await p.c.post("/api/campaigns", campaignBody(500)), [201]);
    row("invite member", "canManageTeam", await p.c.post("/api/organization/invitations", { email: `ent-extra-${role}-${RUN}@ent-sim.local`, role: "member" }), [201, 402], undefined, "402 = permission passed, seat cap refused");
    row("PATCH /api/organization", "canAccessSettings", await p.c.patch("/api/organization", { name: `Ent Roles Org ${RUN}` }), [200]);
    row("GET /api/credits/balance", "canManageBilling", await p.c.get("/api/credits/balance"), [200]);
    const team = await p.c.get("/api/team");
    MATRIX.push({ role, action: "GET /api/team", claimed: "no permission key", actual: team.status, expectedOk: true, ok: true, note: `${Array.isArray(team.body) ? team.body.length : "?"} rows` });
    const fr = await p.c.get("/api/founder/readiness");
    founderProbe[role] = fr.status;
    if (![403, 404].includes(fr.status)) {
      finding(`4-founder-${role}`, "P0", "authority", `${role} (non-founder) reached GET /api/founder/readiness with ${fr.status}`, short(fr));
    }

    if (role === "viewer") {
      const refused = MATRIX.filter((m) => m.role === "viewer" && !["GET /api/team", "export leads", "GET /api/credits/balance"].includes(m.action));
      const leaks = refused.filter((m) => m.actual < 300);
      if (leaks.length) {
        finding("4-viewer-write", "P1", "roles", `viewer completed ${leaks.length} mutation(s): ${leaks.map((l) => `${l.action}=${l.actual}`).join(", ")}`, "viewerReadOnlyGate is documented as refusing every non-exempt mutation");
      }
    }
  }
  metric("roles:founder-route", founderProbe);

  // GET /api/team visibility for restricted roles — a product observation with teeth: team_members carries emails.
  for (const role of ["va", "viewer"] as Role[]) {
    const p = members[role];
    if (!p) continue;
    const team = await p.c.get("/api/team");
    if (team.status === 200 && Array.isArray(team.body) && team.body.some((m: any) => m.email)) {
      finding(`4-team-read-${role}`, "P3", "roles", `${role} can read GET /api/team including teammates' emails`, `${team.body.length} rows; first=${JSON.stringify(team.body[0]).slice(0, 160)}`, "No permission key covers the roster; a VA with assigned-only access still gets the whole team's contact list.");
    }
  }

  // role changes: can a member change another member's role? can an admin grant admin?
  if (members.member && members.viewer) {
    const viewerTm = tmOf(members.viewer)!;
    const byMember = await members.member.c.patch(`/api/team/${viewerTm.id}/role`, { role: "member" });
    metric("roles:member-changes-role", short(byMember, 120));
    if (byMember.status < 300) finding("4-member-role-change", "P1", "roles", "A member changed another member's role via PATCH /api/team/:id/role", short(byMember));
    if (members.admin) {
      const grantAdmin = await members.admin.c.patch(`/api/team/${viewerTm.id}/role`, { role: "admin" });
      const demote = await members.admin.c.patch(`/api/team/${viewerTm.id}/role`, { role: "va" });
      metric("roles:admin-role-change", { grantAdmin: short(grantAdmin, 100), viewerToVa: short(demote, 100) });
      if (grantAdmin.status < 300) finding("4-admin-grants-admin", "P1", "roles", "An admin granted the admin role (documented: only the owner can)", short(grantAdmin));
      if (demote.status !== 200) finding("4-admin-role-change", "P2", "roles", "An admin could not change a viewer to va (documented as allowed)", short(demote));
      await db.query(`UPDATE team_members SET role='viewer', view_only_assigned_leads=false WHERE id=$1`, [viewerTm.id]);
    }
  }

  // VA assigned-only visibility: owner makes 10 leads, assigns 3 to the VA
  if (members.va && vaRow) {
    const va = members.va;
    const ids: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = await owner.c.post("/api/leads", leadBody("va-pool", i));
      if (r.body?.id) ids.push(r.body.id);
    }
    const assignVia: string[] = [];
    for (const id of ids.slice(0, 3)) {
      const r = await owner.c.put(`/api/leads/${id}`, { assignedTo: vaRow.id });
      assignVia.push(short(r, 120));
    }
    metric("roles:va-assign-via-api", assignVia);
    const assigned = await db.query(`SELECT id FROM leads WHERE organization_id=$1 AND assigned_to=$2 AND id = ANY($3)`, [orgId, vaRow.id, ids]);
    if (assigned.rowCount !== 3) {
      finding("4-assign-api", "P1", "roles",
        `Owner (canAssignLeads) could not assign a lead to a team member via PUT /api/leads/:id {assignedTo: <team_members.id>} — ${assigned.rowCount}/3 persisted`,
        `responses: ${assignVia.join(" | ")}`,
        "leads.assigned_to is documented as the team member id (shared/schema.ts:552) but the PUT validates assignedTo against team_members.user_id (a uuid) in assertUserIsOrgMember — so no integer assignee can ever pass. Assignment is unreachable from the API.",
        "PUT /api/leads/:id {assignedTo: <team_members.id>} as owner");
      await db.query(`UPDATE leads SET assigned_to=$2 WHERE organization_id=$1 AND id = ANY($3)`, [orgId, vaRow.id, ids.slice(0, 3)]);
      metric("roles:va-assign-fallback", "assigned 3 via SQL to continue the visibility probe");
    }
    const seen = await va.c.get("/api/leads?pageSize=100");
    const seenIds: number[] = (seen.body?.data ?? []).map((l: any) => l.id);
    const seenAssignees = new Set((seen.body?.data ?? []).map((l: any) => l.assignedTo));
    const unassignedSeen = ids.slice(3).filter((id) => seenIds.includes(id));
    metric("roles:va-list", { status: seen.status, total: seen.body?.total, seen: seenIds.length, assignees: [...seenAssignees], unassignedPoolLeadsVisible: unassignedSeen.length, vaFlagOnRow: vaRow.view_only_assigned_leads });
    if (seen.status === 200 && (unassignedSeen.length > 0 || [...seenAssignees].some((a) => a !== vaRow.id))) {
      finding("4-va-sees-unassigned", "P1", "roles",
        `VA lists leads not assigned to them: ${unassignedSeen.length} of the 7 unassigned pool leads visible, total=${seen.body?.total}`,
        `team_members.view_only_assigned_leads=${vaRow.view_only_assigned_leads}; /api/me/permissions.viewOnlyAssignedLeads=${(await va.c.get("/api/me/permissions")).body?.permissions?.viewOnlyAssignedLeads}`,
        "The VA role exists so an outsourced caller sees only their slice. The accept path writes the row with the flag false, which overrides the role default.",
        "invite role=va → accept → GET /api/leads");
    }
    // by-id read of an unassigned lead, and an edit of an ASSIGNED one
    const byId = await va.c.get(`/api/leads/${ids[9]}`);
    const editAssigned = await va.c.put(`/api/leads/${ids[0]}`, { notes: "va edit" });
    metric("roles:va-by-id-unassigned", short(byId, 80));
    metric("roles:va-edit-assigned", short(editAssigned, 160));
    if (byId.status === 200 && vaRow.view_only_assigned_leads) {
      finding("4-va-by-id", "P2", "roles", "An assigned-only VA can read an unassigned lead by id (GET /api/leads/:id has no assigned filter)", short(byId, 120));
    }
    if (editAssigned.status !== 200) {
      finding("4-va-edit-assigned", "P2", "roles",
        `A VA cannot edit a lead that IS assigned to them (${editAssigned.status})`,
        short(editAssigned, 200),
        "assertAssignedLeadWritable compares leads.assigned_to (team member id) with req.user.id (uuid): they can never be equal, so an assigned-only caller can write nothing at all — the 'edit own leads' half of the VA contract is unreachable.");
    }
    // Now the DOCUMENTED path: an admin flips the per-user toggle (Settings → Members) and the VA becomes assigned-only.
    const toggle = await owner.c.patch(`/api/team/${vaRow.id}/view-only-assigned-leads`, { viewOnlyAssignedLeads: true });
    metric("roles:va-toggle", short(toggle, 120));
    if (toggle.status !== 200) {
      skip("roles/va-assigned-only", `PATCH /api/team/:id/view-only-assigned-leads → ${short(toggle)}`);
    } else {
      const claims2 = (await va.c.get("/api/me/permissions")).body?.permissions;
      const seen2 = await va.c.get("/api/leads?pageSize=100");
      const ids2: number[] = (seen2.body?.data ?? []).map((l: any) => l.id);
      const unassignedSeen2 = ids.slice(3).filter((id) => ids2.includes(id));
      const byId2 = await va.c.get(`/api/leads/${ids[9]}`);
      const editAssigned2 = await va.c.put(`/api/leads/${ids[0]}`, { notes: "va edit (assigned-only)" });
      const editUnassigned2 = await va.c.put(`/api/leads/${ids[9]}`, { notes: "va edit unassigned" });
      const create2 = await va.c.post("/api/leads", leadBody("va-own-create", 1));
      metric("roles:va-assigned-only", { claimsViewOnly: claims2?.viewOnlyAssignedLeads, listTotal: seen2.body?.total, unassignedVisible: unassignedSeen2.length, byIdUnassigned: byId2.status, editAssigned: short(editAssigned2, 160), editUnassigned: editUnassigned2.status, create: create2.status });
      if (claims2?.viewOnlyAssignedLeads !== true) {
        finding("4-va-toggle-claim", "P1", "roles", "After the owner set view-only-assigned-leads=true, /api/me/permissions still claims viewOnlyAssignedLeads=false", JSON.stringify(claims2));
      }
      if (seen2.status === 200 && (unassignedSeen2.length > 0 || seen2.body?.total !== 3)) {
        finding("4-va-toggled-sees-unassigned", "P1", "roles", `Assigned-only VA still lists ${seen2.body?.total} leads (${unassignedSeen2.length} unassigned pool leads) — expected exactly the 3 assigned`, short(seen2, 120));
      }
      if (byId2.status === 200) {
        finding("4-va-by-id", "P2", "roles", "An assigned-only VA can read an unassigned lead by id (GET /api/leads/:id applies no assigned filter, the list does)", short(byId2, 120), "The list hides what the detail route serves: the restriction is a view filter, not an access rule.");
      }
      if (editUnassigned2.status < 300) {
        finding("4-va-edit-unassigned", "P1", "roles", "An assigned-only VA edited an unassigned lead", short(editUnassigned2, 120));
      }
      if (editAssigned2.status !== 200) {
        finding("4-va-edit-assigned", "P1", "roles",
          `An assigned-only VA cannot edit a lead that IS assigned to them (${editAssigned2.status})`,
          short(editAssigned2, 200),
          "assertAssignedLeadWritable compares leads.assigned_to (a team_members.id integer, per shared/schema.ts:552 and the list filter) with req.user.id (a users.id uuid). They can never be equal, so the 'edit your own leads' half of the VA contract is unreachable: the role becomes read-only on exactly the leads it is meant to work.",
          "toggle view-only-assigned-leads on a va; assign a lead to their team_members.id; PUT /api/leads/:id as the va");
      }
    }
  } else {
    skip("roles/va-visibility", "no accepted va persona");
  }
  metric("roles:matrix", MATRIX);
}

// ═══════════════════════════════ 5. STRIPE WEBHOOK ═══════════════════════════════

async function scenarioWebhook(p: Persona) {
  console.log(`\n[${SIM}] 5. stripe webhook`);
  const orgId = p.orgId!;
  const before = (await orgRow(orgId)).credit_balance;
  const evtId = `evt_ent_${RUN}`;
  const event = {
    id: evtId,
    object: "event",
    api_version: "2024-06-20",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `cs_ent_${RUN}`,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        amount_total: 5000,
        currency: "usd",
        metadata: { type: "credit_purchase", organizationId: String(orgId), packId: "pack_50" },
      },
    },
  };
  const payload = JSON.stringify(event);
  const post = (body: string, headers: Record<string, string>) =>
    p.c.call("POST", "/api/stripe/webhook", undefined, { raw: body, headers: { "content-type": "application/json", ...headers }, noCsrf: true, noAuth: true });

  const noSig = await post(payload, {});
  const fakeSig = await post(payload, { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` });
  const replay = await post(payload, { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` });
  const garbage = await post("{not json at all", { "stripe-signature": "t=1,v1=zz" });
  const after = (await orgRow(orgId)).credit_balance;
  const claimed = await db.query(`SELECT count(*)::int AS n FROM stripe_processed_events WHERE stripe_event_id=$1`, [evtId]);
  const tx = await db.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE organization_id=$1`, [orgId]);
  metric("webhook", { noSig: short(noSig, 120), fakeSig: short(fakeSig, 120), replay: short(replay, 120), garbage: short(garbage, 120), creditBefore: before, creditAfter: after, claimRows: claimed.rows[0].n, creditTx: tx.rows[0].n });
  if (after !== before || claimed.rows[0].n > 0) {
    finding("5-unsigned-mints", "P0", "billing", "An UNSIGNED Stripe webhook minted credits / was claimed as processed", `balance ${before}→${after}; stripe_processed_events rows for ${evtId}: ${claimed.rows[0].n}`);
  }
  for (const [name, r] of [["no-signature", noSig], ["fake-signature", fakeSig], ["garbage", garbage]] as const) {
    if (r.status < 400) finding(`5-accepted-${name}`, "P0", "billing", `POST /api/stripe/webhook (${name}) returned ${r.status}`, short(r));
    if (r.status >= 500) finding(`5-5xx-${name}`, "P2", "robustness", `POST /api/stripe/webhook (${name}) returned ${r.status}`, short(r));
  }
  skip("webhook/idempotency", `STRIPE_WEBHOOK_SECRET is unset in the running server, so verifyAndParseEvent throws before claimEvent — the same event id twice returns ${replay.status} both times and the duplicate-claim path is unobservable. With a secret: sign as stripe-signature: t=<unix>,v1=hex(HMAC-SHA256(secret, \`\${t}.\${rawBody}\`)) and the second delivery must be skipped as a duplicate without a second credit_transactions row.`);
}

// ═══════════════════════════════ 6. CREDITS LEDGER ═══════════════════════════════

async function scenarioCredits() {
  console.log(`\n[${SIM}] 6. credits ledger`);
  const p = await freshPersona("credits");
  const orgId = p.orgId!;
  await db.query(
    `UPDATE organizations SET subscription_tier='pro', credit_balance=100, settings = coalesce(settings,'{}')::jsonb || '{"simulationMode":true}' WHERE id=$1`,
    [orgId],
  );
  const ids: number[] = [];
  for (let i = 1; i <= 150; i++) {
    const r = await p.c.post("/api/leads", leadBody("credits", i));
    if (r.body?.id) ids.push(r.body.id);
    else { skip("credits/leads", `lead #${i} → ${short(r)}`); break; }
  }
  if (ids.length < 150) return;
  const camp = await p.c.post("/api/campaigns", campaignBody(1));
  if (camp.status !== 201) { skip("credits/campaign", short(camp)); return; }
  const cid = camp.body.id;
  const balance = async () => (await orgRow(orgId)).credit_balance as number;
  const txCount = async () => (await db.query(`SELECT count(*)::int AS n, coalesce(sum(amount_cents),0)::int AS sum FROM credit_transactions WHERE organization_id=$1`, [orgId])).rows[0];
  const deliveries = async () => (await db.query(`SELECT count(*)::int AS n FROM campaign_delivery_events WHERE campaign_id=$1`, [cid])).rows[0].n;

  // 150 recipients against 100¢
  const over = await p.c.post(`/api/campaigns/${cid}/send-email`, { leadIds: ids });
  const b1 = await balance(); const t1 = await txCount(); const d1 = await deliveries();
  metric("credits:over-send", { resp: short(over, 200), balance: b1, tx: t1, deliveries: d1 });
  if (over.status !== 429 && over.status !== 402) {
    finding("6-over-send-status", "P1", "billing", `Sending to 150 leads with 100¢ returned ${over.status}, not a refusal`, short(over));
  }
  if (b1 !== 100 || d1 !== 0) {
    finding("6-over-send-deducted", "P1", "billing", `A refused send still moved money/mail: balance 100→${b1}, deliveries=${d1}`, JSON.stringify({ tx: t1 }));
  }
  // 100 recipients → balance must be exactly 100 - sent
  const exact = await p.c.post(`/api/campaigns/${cid}/send-email`, { leadIds: ids.slice(0, 100) });
  const sent = exact.body?.sent ?? exact.body?.results?.sent;
  const failed = exact.body?.failed ?? exact.body?.results?.failed;
  const b2 = await balance(); const t2 = await txCount(); const d2 = await deliveries();
  metric("credits:exact-send", { resp: short(exact, 200), sent, failed, balance: b2, tx: t2, deliveries: d2 });
  if (exact.status !== 200) {
    finding("6-exact-send", "P1", "billing", `Sending to exactly 100 leads with 100¢ returned ${exact.status}`, short(exact));
  } else if (typeof sent === "number" && b2 !== 100 - sent) {
    finding("6-ledger-arith", "P1", "billing", `Credit arithmetic is off: 100¢ − ${sent} sent ≠ ${b2}¢ balance (failed=${failed})`, JSON.stringify({ tx: t2, deliveries: d2 }));
  } else if (typeof sent === "number" && d2 !== sent) {
    finding("6-delivery-rows", "P2", "billing", `Charged for ${sent} sends but ${d2} delivery rows exist`, JSON.stringify(t2));
  }
  // balance 0 → one more refused
  await setOrg(orgId, { credit_balance: 0 });
  const zero = await p.c.post(`/api/campaigns/${cid}/send-email`, { leadIds: [ids[120]] });
  const b3 = await balance();
  metric("credits:zero-send", { resp: short(zero, 160), balance: b3 });
  if (zero.status < 400 || b3 !== 0) finding("6-zero-send", "P1", "billing", `With 0¢ a 1-recipient send returned ${zero.status}; balance now ${b3}`, short(zero));
  // API balance == DB
  const api = await p.c.get("/api/credits/balance");
  metric("credits:api-balance", { api: api.body, db: b3 });
  if (api.status !== 200 || api.body?.balance !== b3) finding("6-balance-api", "P2", "billing-meter", `GET /api/credits/balance=${JSON.stringify(api.body)} ≠ DB credit_balance=${b3}`, short(api));
}

// ═══════════════════════════════ 7. EXPORT QUOTA ═══════════════════════════════

/**
 * The export limiter (identityRateLimiters.ts) keys on req.auth.userId, which production's global
 * clerkMiddleware populates BEFORE the limiter (routes.ts:765). Under E2E test-auth, req.auth is
 * only populated per-route by isAuthenticated — AFTER the limiter — so here every export from this
 * process shares one bucket: `erl:export-user:export:ip:127.0.0.1`, and earlier sims today drain
 * it. Clearing that single key makes the cap measurable; the per-user claim stays UNOBSERVABLE here.
 */
async function resetExportBucket(label: string): Promise<string> {
  const bucketKey = "erl:export-user:export:ip:127.0.0.1";
  let cleared = "not attempted";
  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    const keys = await redis.keys("erl:export-user:*");
    const n = await redis.del(bucketKey);
    cleared = `deleted ${n} key(s); bucket keys before: ${JSON.stringify(keys)}`;
    await redis.quit();
  } catch (e) {
    cleared = `failed: ${String(e).slice(0, 120)}`;
  }
  metric(`export:bucket-reset:${label}`, cleared);
  return cleared;
}

async function scenarioExportQuota() {
  console.log(`\n[${SIM}] 7. export quota`);
  const cleared = await resetExportBucket("before-quota");

  const a = await freshPersona("export-a");
  const b = await freshPersona("export-b");
  const run = async (p: Persona) => {
    const codes: number[] = [];
    let last: Resp | null = null;
    for (let i = 0; i < 6; i++) { last = await p.c.get("/api/leads/export"); codes.push(last.status); }
    return { codes, last: last! };
  };
  const ra = await run(a);
  const rb = await run(b);
  metric("export:quota", { orgA: ra.codes, orgB: rb.codes, sixthBodyA: ra.last.text.slice(0, 160), retryAfterA: ra.last.headers.get("retry-after") ?? ra.last.headers.get("ratelimit-reset") });
  const okA = ra.codes.slice(0, 5).every((s) => s === 200) && ra.codes[5] === 429;
  if (!okA) {
    if (ra.codes[0] === 429) {
      skip("export/cap", `the shared IP bucket was still drained after reset (${cleared}); org A codes ${JSON.stringify(ra.codes)}`);
    } else {
      finding("7-quota-a", "P2", "rate-limits", `Export quota is not 5/day: org A codes ${JSON.stringify(ra.codes)}`, ra.last.text.slice(0, 200));
    }
  }
  if (rb.codes[0] === 429) {
    skip("export/per-org-isolation",
      `second org's first export → 429 from the same bucket. Under E2E the limiter keys per IP (req.auth is set per-route, after the global limiter); production keys per USER via clerkMiddleware. Per-user isolation is unobservable here. Note the contract itself is per-user, not per-org (identityRateLimiters.ts: "honestly per-user"): a 5-seat org gets 25 exports/day.`);
  } else if (!(rb.codes.slice(0, 5).every((s) => s === 200) && rb.codes[5] === 429)) {
    finding("7-quota-b", "P2", "rate-limits", `Second org's quota is not an independent 5/day: ${JSON.stringify(rb.codes)}`, rb.last.text.slice(0, 200));
  }
}

// ═══════════════════════════════ 8. DATA DELETION ═══════════════════════════════

async function scenarioDeletion() {
  console.log(`\n[${SIM}] 8. data deletion`);
  const p = await freshPersona("delete");
  const orgId = p.orgId!;
  for (let i = 1; i <= 3; i++) await p.c.post("/api/leads", leadBody("delete", i));
  const bad = await p.c.post("/api/privacy/delete", { confirm: "yes" });
  const del = await p.c.post("/api/privacy/delete", { confirm: "DELETE MY DATA" });
  const status = await p.c.get("/api/privacy/status");
  const leadsAfter = await p.c.get("/api/leads?pageSize=10");
  const me = await p.c.get("/api/auth/user");
  const orgApi = await p.c.get("/api/organization");
  const dsar = await db.query(`SELECT id, request_type, fulfilled_at, sla_deadline_at FROM dsar_requests_lifecycle WHERE requester_email=$1 ORDER BY received_at DESC LIMIT 3`, [p.email]);
  const user = await db.query(`SELECT email FROM users WHERE id=$1`, [p.userId]);
  const org = await orgRow(orgId);
  const leadsDb = await dbCounts(orgId);
  metric("deletion", {
    wrongConfirm: short(bad, 100), ack: short(del, 220), status: status.body, leadsReadable: { status: leadsAfter.status, total: leadsAfter.body?.total },
    dsarRows: dsar.rows, userRow: user.rows[0], orgStatus: org.subscription_status, leadsDb,
    pendingFlagInAuthUser: Object.keys(me.body ?? {}).filter((k) => /delet|dsar|pending|erasure/i.test(k)),
    pendingFlagInOrg: Object.keys(orgApi.body ?? {}).filter((k) => /delet|dsar|pending|erasure/i.test(k)),
  });
  if (bad.status !== 400) finding("8-confirm", "P2", "privacy", `POST /api/privacy/delete with the wrong confirm string returned ${bad.status}`, short(bad));
  if (del.status !== 202) { finding("8-ack", "P1", "privacy", `POST /api/privacy/delete returned ${del.status}, not 202`, short(del)); return; }
  const open = (status.body?.open ?? []) as any[];
  const pendingShown = open.some((o) => o.type === "erasure");
  if (!pendingShown) {
    finding("8-no-pending", "P1", "privacy", "Deletion was acknowledged (202) but GET /api/privacy/status shows no open erasure request", JSON.stringify(status.body));
  }
  if (leadsAfter.status === 200 && (leadsAfter.body?.total ?? 0) > 0) {
    const sev: Severity = pendingShown ? "UX" : "P1";
    finding("8-readable", sev, "privacy",
      `After a 202 deletion ack the owner can still read all ${leadsAfter.body.total} leads${pendingShown ? " (status endpoint does show the request as open)" : " and nothing shows a pending state"}`,
      `GET /api/leads → ${leadsAfter.status} total=${leadsAfter.body.total}; /api/privacy/status.open=${JSON.stringify(open)}; /api/auth/user keys mentioning deletion: none; /api/organization: none`,
      "The 202 message says the account stays active until fulfilment (24h SLA); the only pending signal is on the Privacy page — nowhere in the app shell. A customer who asked for erasure and sees their full CRM an hour later has no in-product evidence the request exists.");
  }
}

// ═══════════════════════════════ main ═══════════════════════════════

async function main() {
  await db.connect();
  const health = await new SimClient("ent-health").get("/api/healthz", { noAuth: true, noCsrf: true });
  if (health.status !== 200) throw new Error(`server not healthy: ${short(health)}`);

  // A crash in one scenario is a skip for that scenario, never a reason to lose the others' evidence.
  const guard = async (name: string, fn: () => Promise<unknown>) => {
    try { return await fn(); } catch (e) { skip(name, `harness crash: ${String(e).slice(0, 300)}`); return null; }
  };
  const freeOrg = (await guard("free-walls", scenarioFreeWalls)) as Persona | null;
  if (freeOrg) await guard("tier-change", () => scenarioTierChange(freeOrg));
  else skip("tier-change", "free-walls did not yield an org");
  await guard("trial", scenarioTrial);
  // the roles matrix exports once per role; the shared E2E IP bucket must not pre-empt the permission check
  await resetExportBucket("before-roles");
  await guard("roles", scenarioRoles);
  if (freeOrg) await guard("webhook", () => scenarioWebhook(freeOrg));
  await guard("credits", scenarioCredits);
  await guard("export-quota", scenarioExportQuota);
  await guard("deletion", scenarioDeletion);

  // role × action matrix
  console.log(`\n[${SIM}] role × action matrix (claimed → actual)`);
  const actions = [...new Set(MATRIX.map((m) => m.action))];
  const header = ["action", ...ROLE_LIST].join(" | ");
  console.log(header);
  for (const a of actions) {
    const cells = ROLE_LIST.map((r) => {
      const m = MATRIX.find((x) => x.role === r && x.action === a);
      return m ? `${m.claimed === true ? "Y" : m.claimed === false ? "N" : "-"}→${m.actual}${m.ok ? "" : " !!"}` : "skip";
    });
    console.log([a, ...cells].join(" | "));
  }
  await db.end();
  console.log(`[${SIM}] done`);
}

main().catch((e) => { console.error(e); process.exit(1); });
