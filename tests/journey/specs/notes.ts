/**
 * Notes journey walk — the declarative spec (journey-proof harness), N1.
 *
 * The note investor's loop, walked on a fresh dedicated persona org:
 * onboard → tape import (the first-value moment) → the carried book →
 * the acquisition pipeline → the delinquency ladder (the reference
 * implementation) → workout NPV → yield read → exit (payoff quote and the
 * assignment paperwork) → Pax read.
 *
 * Every step's `mustObserve` is a hypothesis about the product, not a wish:
 * the leg checks it and the walk stops at the first leg that disagrees.
 *
 * FENCES CARRIED INTO THE SPEC
 * - Nothing is sent. The exit leg renders a PDF and records a quote; it
 *   emails no one and records nothing with a county.
 * - No real money moves. A payoff quote is a record of a figure, and the
 *   assignment is paperwork; no payment path is touched.
 * - Every fixture is synthetic (SYNTH- loan numbers, "SYNTHETIC" borrowers).
 *
 * DATES: the late notes' due dates are derived from the run's own clock, so
 * the ladder stage a note sits at is a property of the walk, not of the day
 * the spec was written.
 */
import { defineWalkSpec } from "../walk-spec";
import type { StepObservation, WalkContext, WalkSpec } from "../walk-spec";

const DAY_MS = 86_400_000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

/** The tape. Header spellings are seller-tape spellings; the importer suggests the mapping. */
function buildTape(tag: string): { csv: string; badRowNumber: number } {
  const header =
    "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Paid Thru,Next Due,APN,State,County,Property Address,Original Note,Mortgage/DOT,Assignments,Allonges,Pay History,Collateral Exceptions";
  const nextDue45 = isoDaysAgo(45);
  const nextDue100 = isoDaysAgo(100);
  const rows = [
    // A — performing, next due in the future (current).
    `${tag}-A,SYNTHETIC Borrower A,"$120,000.00","$84,250.00",8.5%,360,922.70,1,2015-03-01,2045-03-01,2026-09-15,"$61,500.00",Performing,2026-11-01,${isoDaysAgo(-8)},,NC,Wake,1 Synthetic Ln,Yes,Yes,Yes,Yes,Yes,`,
    // B — 45 days past due (ladder: 30–59).
    `${tag}-B,SYNTHETIC Borrower B,"60,000","59,100.00",9,240,539.84,5,2024-01-05,2044-01-05,2026-09-15,"40,000",late,,${nextDue45},,NC,Wake,3 Synthetic Rd,yes,yes,yes,,,`,
    // C — 100 days past due (ladder: 90+).
    `${tag}-C,SYNTHETIC Borrower C,"75,000","70,450.10",9.0,300,629.40,10,2023-06-10,2048-06-10,2026-09-15,"52,000",late,,${nextDue100},,NC,Wake,5 Synthetic Ct,yes,yes,yes,yes,no,`,
    // D — a performing note with a balloon and a document exception.
    `${tag}-D,SYNTHETIC Borrower D,"45,000","38,912.44",10,180,483.57,15,2019-03-15,2034-03-15,2026-09-15,"22,000",performing,2026-11-15,${isoDaysAgo(-22)},,TN,Davidson,2 Synthetic Ave,present,present,exception,,missing,AOM from SYNTHETIC Bank to SYNTHETIC Trust unrecorded`,
    // BAD — an impossible date: the importer must refuse the row, with the field and the fix.
    `${tag}-BAD,SYNTHETIC Borrower Bad,"30,000","12,000.00",7.25,120,352.24,1,2020-02-30,2030-02-01,2026-09-15,"9,000",performing,,${isoDaysAgo(-5)},,,,,yes,no,yes,,,`,
  ];
  return { csv: [header, ...rows].join("\n") + "\n", badRowNumber: 6 };
}

function body(res: { body: any }): any {
  return res.body ?? {};
}

function fail(res: { status: number; body: any }): string {
  return `${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`;
}

async function noteIdsByNumber(ctx: WalkContext): Promise<Record<string, any>> {
  const book = await ctx.api("GET", "/api/notes/acquired?limit=200");
  ctx.check(book.status === 200, `GET /api/notes/acquired must return 200, got ${fail(book)}`);
  const out: Record<string, any> = {};
  for (const n of body(book).notes ?? []) out[n.noteNumber] = n;
  return out;
}

export const notesWalk: WalkSpec = defineWalkSpec({
  id: "notes",
  vertical: "note_investor",
  title: "Notes journey — tape import to the ladder, the workout, the yield and the exit",
  version: 1,
  fences: { noSend: true, noRealMoney: true, stagingOnly: true },
  org: { businessType: "note_investor", nameSuffix: "Notes LLC", skipSampleData: true },
  realdbRoutes: [],
  cleanupTables: ["note_assignments", "note_payoff_quotes", "note_events", "note_field_observations", "note_acquisitions", "acquired_notes"],
  steps: [
    {
      id: "onboard",
      title: "Onboard — a fresh note_investor persona org, no sample data",
      kind: "api",
      how: "The driver provisions the persona's own org and the note_investor templates. The step then does what the wizard does: PUT /api/me/persona, POST /api/onboarding/complete (seedSampleData:false, noteRole invest), then re-reads needs-onboarding, the persona and the organization.",
      mustObserve:
        "needs-onboarding is true before and false after; the persona reads back note_investor; the org's onboardingData.businessType is note_investor; the acquired book is empty (total 0) — no sample data.",
      async run(ctx) {
        const before = await ctx.api("GET", "/api/me/needs-onboarding");
        ctx.check(before.status === 200, `GET needs-onboarding must return 200, got ${fail(before)}`);
        ctx.check(body(before).needsOnboarding === true, `a fresh persona must need onboarding, got ${JSON.stringify(body(before))}`);
        const persona = await ctx.api("PUT", "/api/me/persona", { persona: "note_investor", businessType: "note_investor" });
        ctx.check(persona.status === 200, `PUT /api/me/persona must return 200, got ${fail(persona)}`);
        const complete = await ctx.api("POST", "/api/onboarding/complete", {
          businessType: "note_investor",
          noteRole: "invest",
          seedSampleData: false,
        });
        ctx.check(complete.status === 200, `POST /api/onboarding/complete must return 200, got ${fail(complete)}`);
        const after = await ctx.api("GET", "/api/me/needs-onboarding");
        ctx.check(body(after).needsOnboarding === false, `after completing, needsOnboarding must be false, got ${JSON.stringify(body(after))}`);
        const me = await ctx.api("GET", "/api/me/persona");
        ctx.check(me.status === 200 && body(me).persona === "note_investor", `persona must read back note_investor, got ${fail(me)}`);
        const org = await ctx.api("GET", "/api/organization");
        ctx.check(org.status === 200, `GET /api/organization must return 200, got ${org.status}`);
        const businessType = body(org).onboardingData?.businessType;
        ctx.check(businessType === "note_investor", `org onboardingData.businessType must be note_investor, got ${JSON.stringify(businessType)}`);
        const book = await ctx.api("GET", "/api/notes/acquired");
        ctx.check(book.status === 200 && body(book).total === 0, `a fresh org's acquired book must be empty, got ${fail(book)}`);
        return {
          observed: {
            orgId: ctx.orgId,
            needsOnboardingBefore: true,
            needsOnboardingAfter: false,
            persona: body(me).persona,
            businessType,
            acquiredBookTotal: body(book).total,
          },
        };
      },
    },
    {
      id: "templates-installed",
      title: "Templates — the note_investor starter set actually installed (bar item d)",
      kind: "api",
      how: "GET /api/campaigns and read the org's settings back from GET /api/organization.",
      mustObserve:
        "A draft campaign named 'Payment Reminder Sequence' exists, and the org's settings carry the note defaults (defaultInterestRate 9.5, gracePeriodDays 10, lateFeePercent 5).",
      async run(ctx) {
        const campaigns = await ctx.api("GET", "/api/campaigns");
        ctx.check(campaigns.status === 200, `GET /api/campaigns must return 200, got ${campaigns.status}`);
        const list: any[] = Array.isArray(campaigns.body) ? campaigns.body : [];
        const reminder = list.find((c) => c.name === "Payment Reminder Sequence");
        ctx.check(!!reminder, `the 'Payment Reminder Sequence' template campaign must be installed; campaigns: ${JSON.stringify(list.map((c) => c.name))}`);
        ctx.check(reminder.status === "draft", `the installed template must be a draft (nothing sends), got ${JSON.stringify(reminder.status)}`);
        const org = await ctx.api("GET", "/api/organization");
        const settings = body(org).settings ?? {};
        ctx.check(
          settings.defaultInterestRate === 9.5 && settings.gracePeriodDays === 10 && settings.lateFeePercent === 5,
          `org settings must carry the note defaults, got ${JSON.stringify({ r: settings.defaultInterestRate, g: settings.gracePeriodDays, l: settings.lateFeePercent })}`,
        );
        return {
          observed: {
            campaigns: list.map((c) => ({ name: c.name, status: c.status })),
            settings: { defaultInterestRate: settings.defaultInterestRate, gracePeriodDays: settings.gracePeriodDays, lateFeePercent: settings.lateFeePercent },
          },
        };
      },
    },
    {
      id: "tape-preview",
      title: "Tape preview — map and validate, write nothing",
      kind: "api",
      how: "POST /api/note-tape/preview with a five-row synthetic tape (four good rows, one with an impossible date) and no mapping, so the importer suggests one from the header row.",
      mustObserve:
        "200. The mapping is suggested, not applied as fact (mappingWasSuggested true). Four rows validate, one is rejected with the row number and the field named, no required column is unmapped, and the acquired book is still empty afterward.",
      async run(ctx) {
        const { csv, badRowNumber } = buildTape(ctx.tag);
        ctx.store("tapeCsv", csv);
        ctx.store("badRow", badRowNumber);
        const preview = await ctx.api("POST", "/api/note-tape/preview", { csv, fileName: `${ctx.tag}-tape.csv` });
        ctx.check(preview.status === 200, `POST /api/note-tape/preview must return 200, got ${fail(preview)}`);
        const p = body(preview);
        ctx.check(p.mappingWasSuggested === true, `the mapping must be a suggestion, got mappingWasSuggested=${JSON.stringify(p.mappingWasSuggested)}`);
        const v = p.validation ?? {};
        ctx.check((v.unmappedRequired ?? []).length === 0, `no required column may be unmapped; unmapped: ${JSON.stringify(v.unmappedRequired)}`);
        ctx.check(v.summary?.validCount === 4, `four rows must validate, got summary ${JSON.stringify(v.summary)}`);
        ctx.check(v.summary?.rejectedCount === 1, `one row must be rejected, got summary ${JSON.stringify(v.summary)}`);
        const rejected = (v.rejected ?? [])[0] ?? {};
        ctx.check(rejected.fileRow === badRowNumber, `the rejected row must be file row ${badRowNumber}, got ${JSON.stringify(rejected).slice(0, 300)}`);
        ctx.store("tapeMapping", p.mapping);
        const book = await ctx.api("GET", "/api/notes/acquired");
        ctx.check(body(book).total === 0, `a preview writes nothing — the book must still be empty, got total ${JSON.stringify(body(book).total)}`);
        return {
          observed: {
            summary: v.summary,
            rejected: JSON.stringify(rejected).slice(0, 400),
            mappedFields: Object.keys(p.mapping ?? {}).length,
            unmatchedHeaders: p.unmatchedHeaders,
            acquiredBookTotalAfterPreview: body(book).total,
          },
        };
      },
    },
    {
      id: "tape-refuse-partial",
      title: "Tape commit refuses a partial import",
      kind: "api",
      how: "POST /api/note-tape/commit with the confirmed mapping but WITHOUT excluding the rejected row.",
      mustObserve: "400. The commit is refused with the rejected row reported, and nothing is imported (the book is still empty).",
      async run(ctx) {
        const res = await ctx.api("POST", "/api/note-tape/commit", {
          csv: ctx.get<string>("tapeCsv"),
          fileName: `${ctx.tag}-tape.csv`,
          mapping: ctx.get("tapeMapping"),
          excludeRows: [],
        });
        ctx.check(res.status === 400, `an unresolved rejected row must refuse the commit with 400, got ${fail(res)}`);
        const book = await ctx.api("GET", "/api/notes/acquired");
        ctx.check(body(book).total === 0, `a refused commit imports nothing, got total ${JSON.stringify(body(book).total)}`);
        return { observed: { status: res.status, message: String(body(res).message ?? "").slice(0, 300), acquiredBookTotal: body(book).total } };
      },
    },
    {
      id: "tape-commit",
      title: "Tape commit — the first-value moment: four notes on the book",
      kind: "api",
      how: "POST /api/note-tape/commit with the confirmed mapping and the rejected row explicitly excluded.",
      mustObserve:
        "200 status 'committed': four notes created, none appended to an existing note, the excluded row reported back. Re-committing the same tape creates nothing new (a loan number the org already holds is never overwritten).",
      async run(ctx) {
        const args = {
          csv: ctx.get<string>("tapeCsv"),
          fileName: `${ctx.tag}-tape.csv`,
          mapping: ctx.get("tapeMapping"),
          excludeRows: [ctx.get<number>("badRow")],
          asOf: null,
        };
        const res = await ctx.api("POST", "/api/note-tape/commit", args);
        ctx.check(res.status === 200, `POST /api/note-tape/commit must return 200, got ${fail(res)}`);
        const r = body(res);
        ctx.check(r.status === "committed", `commit status must be 'committed', got ${JSON.stringify(r.status)}`);
        ctx.check(r.created === 4 && r.appendedToExisting === 0, `commit must create 4 and append 0, got created=${r.created} appended=${r.appendedToExisting}`);
        ctx.check(JSON.stringify(r.excludedRows) === JSON.stringify([ctx.get<number>("badRow")]), `the excluded row must be reported, got ${JSON.stringify(r.excludedRows)}`);
        const again = await ctx.api("POST", "/api/note-tape/commit", args);
        ctx.check(again.status === 200, `re-committing must return 200, got ${fail(again)}`);
        ctx.check(body(again).created === 0 && body(again).appendedToExisting === 4, `a re-commit must create 0 and append 4 observations, got created=${body(again).created} appended=${body(again).appendedToExisting}`);
        return {
          observed: {
            importId: r.importId,
            created: r.created,
            excludedRows: r.excludedRows,
            collateral: (r.notes ?? []).map((n: any) => `${n.noteNumber}:${n.collateral}`),
            documentsIncomplete: (r.notes ?? []).filter((n: any) => n.documentsIncomplete).map((n: any) => n.noteNumber),
            recommitCreated: body(again).created,
            recommitAppended: body(again).appendedToExisting,
          },
        };
      },
    },
    {
      id: "carried-book",
      title: "Carried book — the imported notes are visible with the tape's own numbers",
      kind: "api",
      how: "GET /api/notes/acquired, then GET /api/notes/:id/record for note A.",
      mustObserve:
        "Total 4, moneyUnit integer_cents, and note A carries exactly the tape's figures in cents (UPB 8,425,000; rate 850 bps; purchase price 6,150,000; payment 92,270). The note record answers 200.",
      async run(ctx) {
        const byNumber = await noteIdsByNumber(ctx);
        const book = await ctx.api("GET", "/api/notes/acquired");
        ctx.check(body(book).total === 4, `the book must hold 4 notes, got total ${JSON.stringify(body(book).total)}`);
        ctx.check(body(book).moneyUnit === "integer_cents", `moneyUnit must be integer_cents, got ${JSON.stringify(body(book).moneyUnit)}`);
        for (const k of ["A", "B", "C", "D"]) {
          ctx.check(!!byNumber[`${ctx.tag}-${k}`], `note ${ctx.tag}-${k} must be on the book; found ${JSON.stringify(Object.keys(byNumber))}`);
          ctx.store(`note${k}`, byNumber[`${ctx.tag}-${k}`].id);
        }
        const a = byNumber[`${ctx.tag}-A`];
        ctx.check(a.currentBalanceCents === 8_425_000, `note A UPB must be 8425000 cents, got ${a.currentBalanceCents}`);
        ctx.check(a.interestRateBps === 850, `note A rate must be 850 bps, got ${a.interestRateBps}`);
        ctx.check(a.acquisitionPriceCents === 6_150_000, `note A purchase price must be 6150000 cents, got ${a.acquisitionPriceCents}`);
        ctx.check(a.paymentAmountCents === 92_270, `note A payment must be 92270 cents, got ${a.paymentAmountCents}`);
        ctx.check(a.payerEncryptedTin === undefined, "the encrypted TIN must never ride the wire");
        const record = await ctx.api("GET", `/api/notes/${ctx.get<string>("noteA")}/record`);
        ctx.check(record.status === 200, `GET /api/notes/:id/record must return 200, got ${fail(record)}`);
        return {
          observed: {
            total: body(book).total,
            moneyUnit: body(book).moneyUnit,
            noteA: { balanceCents: a.currentBalanceCents, rateBps: a.interestRateBps, priceCents: a.acquisitionPriceCents, paymentCents: a.paymentAmountCents, status: a.status },
            statuses: Object.fromEntries(Object.entries(byNumber).map(([k, n]: [string, any]) => [k.replace(`${ctx.tag}-`, ""), n.status])),
            recordKeys: Object.keys(body(record)).slice(0, 12),
          },
        };
      },
    },
    {
      id: "pipeline",
      title: "Acquired-notes pipeline — sourcing to on-book, one note",
      kind: "api",
      how: "POST /api/note-acquisitions (sourcing), PATCH a BPO value, PATCH through diligence → offer_made → funded, then POST …/promote with the terms.",
      mustObserve:
        "201 at sourcing; a BPO value moves the stage to bpo_received on its own; the stage advances; promote answers 201, the pipeline row ends on_book and links the new note; a second promote is refused 400; the promoted note is on the book (total 5).",
      async run(ctx) {
        const created = await ctx.api("POST", "/api/note-acquisitions", {
          payerName: "SYNTHETIC Pipeline Borrower",
          propertyAddress: { line1: "9 Synthetic Way", city: "Raleigh", state: "NC", zip: "27601" },
          sourcedFrom: "walk fixture",
          proposedFaceValueCents: 5_000_000,
          proposedAcquisitionPriceCents: 3_500_000,
          interestRateBps: 900,
          termMonths: 240,
        });
        ctx.check(created.status === 201, `POST /api/note-acquisitions must return 201, got ${fail(created)}`);
        const acq = body(created).acquisition;
        ctx.check(acq?.stage === "sourcing", `a new pipeline row must start at sourcing, got ${JSON.stringify(acq?.stage)}`);
        const id = acq.id;
        const bpo = await ctx.api("PATCH", `/api/note-acquisitions/${id}`, { bpoValueCents: 6_000_000 });
        ctx.check(bpo.status === 200 && body(bpo).acquisition?.stage === "bpo_received", `a BPO value must move the stage to bpo_received, got ${fail(bpo)}`);
        const stages: string[] = [];
        for (const stage of ["diligence", "offer_made", "funded"]) {
          const adv = await ctx.api("PATCH", `/api/note-acquisitions/${id}`, {
            stage,
            ...(stage === "diligence" ? { diligenceChecklist: { noteCopy: { done: true }, paymentHistory: { done: true } } } : {}),
          });
          ctx.check(adv.status === 200 && body(adv).acquisition?.stage === stage, `advancing to ${stage} must return 200 at that stage, got ${fail(adv)}`);
          stages.push(stage);
        }
        const terms = {
          noteNumber: `${ctx.tag}-P`,
          originalPrincipalCents: 5_000_000,
          acquisitionPriceCents: 3_500_000,
          currentBalanceCents: 4_800_000,
          interestRateBps: 900,
          termMonths: 240,
          paymentAmountCents: 44_986,
          paymentDueDay: 1,
          originationDate: "2024-01-01",
          maturityDate: "2044-01-01",
          acquisitionDate: isoDaysAgo(10),
        };
        const promoted = await ctx.api("POST", `/api/note-acquisitions/${id}/promote`, terms);
        ctx.check(promoted.status === 201, `promote must return 201, got ${fail(promoted)}`);
        const noteId = body(promoted).note?.id;
        ctx.check(typeof noteId === "string", "promote must return the new note id");
        ctx.store("promotedNote", noteId);
        const detail = await ctx.api("GET", `/api/note-acquisitions/${id}`);
        ctx.check(body(detail).acquisition?.stage === "on_book" && body(detail).acquisition?.promotedToNoteId === noteId, `the pipeline row must end on_book linked to ${noteId}, got ${JSON.stringify(body(detail).acquisition)?.slice(0, 300)}`);
        const twice = await ctx.api("POST", `/api/note-acquisitions/${id}/promote`, terms);
        ctx.check(twice.status === 400, `a second promote must be refused 400, got ${fail(twice)}`);
        const book = await ctx.api("GET", "/api/notes/acquired");
        ctx.check(body(book).total === 5, `the book must now hold 5 notes, got total ${JSON.stringify(body(book).total)}`);
        return { observed: { acquisitionId: id, stagesWalked: ["sourcing", "bpo_received", ...stages, "on_book"], promotedNoteId: noteId, secondPromote: twice.status, bookTotal: body(book).total } };
      },
    },
    {
      id: "ladder-stages",
      title: "Delinquency ladder — each note sits at the stage its due date earns",
      kind: "api",
      how: "GET /api/notes/:id/delinquency-ladder for notes A (current), B (45 days past due) and C (100 days past due).",
      mustObserve:
        "A: on the ladder, stage current, 0 days. B: stage_30, 45 days. C: stage_90_plus, 100 days. None of the three has a default review recorded — aging never declares default.",
      async run(ctx) {
        const out: Record<string, unknown> = {};
        const expect: Record<string, { stage: string; days?: number }> = {
          A: { stage: "current", days: 0 },
          B: { stage: "stage_30", days: 45 },
          C: { stage: "stage_90_plus", days: 100 },
        };
        for (const k of ["A", "B", "C"]) {
          const res = await ctx.api("GET", `/api/notes/${ctx.get<string>(`note${k}`)}/delinquency-ladder`);
          ctx.check(res.status === 200, `ladder for ${k} must return 200, got ${fail(res)}`);
          const l = body(res);
          ctx.check(l.onLadder === true, `note ${k} must be on the ladder (reason: ${JSON.stringify(l.reason)})`);
          ctx.check(l.current?.stage === expect[k].stage, `note ${k} must sit at ${expect[k].stage}, got ${JSON.stringify(l.current)}`);
          const days = l.current?.daysDelinquent;
          ctx.check(days === expect[k].days, `note ${k} must be ${expect[k].days} days delinquent, got ${days}`);
          ctx.check(l.defaultReview === null, `note ${k} must have no default review (an operator act, never derived from aging), got ${JSON.stringify(l.defaultReview)}`);
          out[k] = { stage: l.current.stage, daysDelinquent: days, escalates: l.escalates, recordedEntries: (l.recorded ?? []).length };
        }
        return { observed: out };
      },
    },
    {
      id: "ladder-default-review",
      title: "Delinquency ladder — escalation bundle and the operator's default-review act",
      kind: "api",
      how: "On note C: GET …/delinquency-ladder/bundle; POST …/default-review with a note; POST it again. On note A: GET the bundle.",
      mustObserve:
        "C's bundle is assembled (not 'not_escalated'). The first default-review answers 200 with who and when; the second is refused 400 (once per note). The ladder then shows the review. A's bundle answers not_escalated.",
      async run(ctx) {
        const c = ctx.get<string>("noteC");
        const bundle = await ctx.api("GET", `/api/notes/${c}/delinquency-ladder/bundle`);
        ctx.check(bundle.status === 200, `C's bundle must return 200, got ${fail(bundle)}`);
        ctx.check(body(bundle).status !== "not_escalated", `C is 100 days past due — its bundle must be assembled, got ${JSON.stringify(body(bundle)).slice(0, 300)}`);
        const review = await ctx.api("POST", `/api/notes/${c}/delinquency-ladder/default-review`, { note: "walk fixture — operator reviewed the file" });
        ctx.check(review.status === 200 && !!body(review).recorded?.recordedAt, `default-review must return 200 with a recorded time, got ${fail(review)}`);
        const second = await ctx.api("POST", `/api/notes/${c}/delinquency-ladder/default-review`, { note: null });
        ctx.check(second.status === 400, `a second default-review must be refused 400, got ${fail(second)}`);
        const ladder = await ctx.api("GET", `/api/notes/${c}/delinquency-ladder`);
        ctx.check(!!body(ladder).defaultReview?.recordedAt, `the ladder must show the recorded default review, got ${JSON.stringify(body(ladder).defaultReview)}`);
        const aBundle = await ctx.api("GET", `/api/notes/${ctx.get<string>("noteA")}/delinquency-ladder/bundle`);
        ctx.check(body(aBundle).status === "not_escalated", `A is current — its bundle must be not_escalated, got ${JSON.stringify(body(aBundle)).slice(0, 200)}`);
        return {
          observed: {
            bundleKeys: Object.keys(body(bundle)).slice(0, 14),
            defaultReviewRecordedBy: body(review).recorded?.recordedBy,
            secondAttempt: second.status,
            ladderShowsReview: true,
            noteABundle: body(aBundle).status,
          },
        };
      },
    },
    {
      id: "workout-npv",
      title: "Workout NPV — modification vs foreclosure on the 100-day note",
      kind: "api",
      how: "POST /api/notes/:C/workout-analyses with a 10% discount rate, an arrears figure, a modification and a foreclosure scenario; then list and fetch the run.",
      mustObserve:
        "200 with a runId; the run is listed (exactly one) and fetchable by id; the run carries the operator's stated inputs, with a result for each scenario stated.",
      async run(ctx) {
        const c = ctx.get<string>("noteC");
        const run = await ctx.api("POST", `/api/notes/${c}/workout-analyses`, {
          discountRateBps: 1000,
          arrearsCents: 629_400 * 3,
          servicingMonthlyCents: 3_000,
          remainingTermMonths: null,
          collateralValueCents: 9_000_000,
          modification: { rateBps: 600, termMonths: 360, arrearsTreatment: "capitalize", principalForbearanceCents: 0, principalReductionCents: 0 },
          foreclosure: { timelineMonths: 12, costs: [{ label: "Attorney and filing", amountCents: 450_000, timing: "upfront" }], citation: null },
        });
        ctx.check(run.status === 200, `POST workout-analyses must return 200, got ${fail(run)}`);
        const r = body(run).run ?? {};
        ctx.check(typeof r.runId === "string", `the run must carry a runId, got keys ${JSON.stringify(Object.keys(r))}`);
        const list = await ctx.api("GET", `/api/notes/${c}/workout-analyses`);
        ctx.check(list.status === 200 && (body(list).runs ?? []).length === 1, `exactly one run must be listed, got ${fail(list)}`);
        const one = await ctx.api("GET", `/api/notes/${c}/workout-analyses/${r.runId}`);
        ctx.check(one.status === 200 && body(one).run?.runId === r.runId, `the run must be fetchable by id, got ${fail(one)}`);
        const text = JSON.stringify(body(one).run);
        ctx.check(/modification/i.test(text) && /foreclosure/i.test(text), "the stored run must carry both stated scenarios");
        return { observed: { runId: r.runId, runKeys: Object.keys(r).slice(0, 16), listed: (body(list).runs ?? []).length } };
      },
    },
    {
      id: "yield-read",
      title: "Yield read — the four measures on a performing note, and its amortization",
      kind: "api",
      how: "GET /api/notes/:A/yield and GET /api/notes/:A/amortization.",
      mustObserve:
        "Current yield is the tape's own arithmetic: 8.5% × $84,250 ÷ $61,500 = 11.64% (to the basis point). The yield-to-maturity is a number greater than the coupon (a discounted purchase), and the amortization schedule is non-empty.",
      async run(ctx) {
        const a = ctx.get<string>("noteA");
        const y = await ctx.api("GET", `/api/notes/${a}/yield`);
        ctx.check(y.status === 200, `GET yield must return 200, got ${fail(y)}`);
        const expected = (0.085 * 84_250) / 61_500;
        const got = body(y).currentYield;
        ctx.check(typeof got === "number" && Math.abs(got - expected) < 0.0001, `current yield must be ${expected.toFixed(4)}, got ${JSON.stringify(got)}`);
        const ytm = body(y).ytmAtAcquisition;
        ctx.check(typeof ytm === "number" && ytm > 0.085, `ytmAtAcquisition must exceed the 8.5% coupon on a discounted purchase, got ${JSON.stringify(ytm)}`);
        const am = await ctx.api("GET", `/api/notes/${a}/amortization`);
        ctx.check(am.status === 200, `GET amortization must return 200, got ${fail(am)}`);
        const sched = body(am).schedule ?? body(am).rows ?? body(am).payments ?? [];
        ctx.check(Array.isArray(sched) && sched.length > 0, `the amortization schedule must be non-empty; keys: ${JSON.stringify(Object.keys(body(am)))}`);
        return { observed: { currentYield: got, ytmAtAcquisition: ytm, irrToDate: body(y).irrToDate, effectiveNetYield: body(y).effectiveNetYield, scheduleRows: sched.length } };
      },
    },
    {
      id: "exit-assignment-paperwork",
      title: "Exit — assignment paperwork rendered, nothing sent, nothing recorded with a county",
      kind: "api",
      how: "POST /api/notes/:D/assignments naming a synthetic assignee; read the PDF bytes' magic; GET the note's assignments list.",
      mustObserve:
        "201 with an assignment row in status 'generated' and a base64 PDF (decodes to %PDF-); the assignment is listed. The row is paperwork only — the walk sends it to no one.",
      async run(ctx) {
        const d = ctx.get<string>("noteD");
        const res = await ctx.api("POST", `/api/notes/${d}/assignments`, {
          assigneeName: "SYNTHETIC Buyer Fund LLC",
          assigneeAddress: { line1: "1 Synthetic Plaza", city: "Charlotte", state: "NC", zip: "28202" },
          state: "TN",
          salePriceCents: 2_600_000,
          saleDate: isoDaysAgo(0),
          notes: "walk fixture",
        });
        ctx.check(res.status === 201, `POST assignments must return 201, got ${fail(res)}`);
        ctx.check(body(res).assignment?.status === "generated", `assignment status must be generated, got ${JSON.stringify(body(res).assignment?.status)}`);
        const b64 = String(body(res).pdfBase64 ?? "");
        ctx.check(b64.length > 1000 && b64.startsWith("JVBERi"), `pdfBase64 must decode to a PDF (starts %PDF), got ${b64.length} chars starting ${JSON.stringify(b64.slice(0, 8))}`);
        const list = await ctx.api("GET", `/api/notes/${d}/assignments`);
        ctx.check(list.status === 200, `GET assignments must return 200, got ${fail(list)}`);
        const rows = body(list).assignments ?? (Array.isArray(body(list)) ? body(list) : []);
        ctx.check(Array.isArray(rows) && rows.length === 1, `exactly one assignment must be listed, got ${JSON.stringify(body(list)).slice(0, 300)}`);
        return { observed: { assignmentId: body(res).assignment?.id, status: body(res).assignment?.status, pdfBase64Chars: b64.length, listed: rows.length } };
      },
    },
    {
      id: "pax-get-notes",
      title: "Pax — read the walked org's notes through Pax, with the coverage statement and the tool receipt",
      kind: "pax",
      how: "The persona acknowledges the Pax disclosure (POST /api/pax/acknowledge-disclosure — the gate every customer passes), then POST /api/ai/chat asks how many notes are on the book. The receipt is the response's own toolCalls entry for get_notes.",
      mustObserve:
        "200. The turn called get_notes and the call succeeded; its result carries a coverage statement naming BOTH books, and the acquired list holds the walked org's five notes (the same loan numbers the carried-book step read). A read leg only: Pax records nothing and sends nothing.",
      paxState: "exercised",
      async run(ctx) {
        const ack = await ctx.api("POST", "/api/pax/acknowledge-disclosure", {});
        ctx.check(ack.status === 200, `POST /api/pax/acknowledge-disclosure must return 200, got ${fail(ack)}`);
        const chat = await ctx.api("POST", "/api/ai/chat", {
          message: "List my notes: how many notes are on my book, and which book does that answer cover?",
        });
        ctx.check(chat.status === 200, `POST /api/ai/chat must return 200, got ${fail(chat)}`);
        const calls: any[] = body(chat).toolCalls ?? [];
        const call = calls.find((c) => c.name === "get_notes");
        ctx.check(!!call, `the turn must call get_notes; tools called: ${JSON.stringify(calls.map((c) => c.name))}`);
        ctx.check(call.result?.success === true, `the get_notes call must succeed, got ${JSON.stringify(call.result).slice(0, 300)}`);
        const data = call.result?.data ?? {};
        const coverage = String(data.coverage ?? "");
        ctx.check(/serviced/i.test(coverage) && /acquired/i.test(coverage), `the coverage statement must name both books, got ${JSON.stringify(coverage).slice(0, 300)}`);
        const acquired: any[] = data.acquired ?? [];
        ctx.check(acquired.length === 5, `Pax must read all five acquired notes, got ${acquired.length}`);
        const numbers = acquired.map((n) => n.noteNumber ?? n.note_number).filter(Boolean).sort();
        const expected = ["A", "B", "C", "D", "P"].map((k) => `${ctx.tag}-${k}`).sort();
        ctx.check(JSON.stringify(numbers) === JSON.stringify(expected), `Pax's acquired notes must be the walked org's loan numbers ${JSON.stringify(expected)}, got ${JSON.stringify(numbers)}`);
        return {
          observed: {
            toolsCalled: calls.map((c) => c.name),
            getNotesSucceeded: true,
            coverage: coverage.slice(0, 400),
            acquiredNotesRead: acquired.length,
            servicedNotesRead: (data.serviced ?? []).length,
            model: body(chat).model,
          },
        };
      },
    },
    {
      id: "exit-payoff-quote",
      title: "Exit — a payoff figure, calculated and then recorded",
      kind: "api",
      how: "GET /api/notes/:A/payoff (the calculator) then POST /api/notes/:A/payoff/quotes (compute and record), then GET …/payoff/quotes.",
      mustObserve:
        "The calculator answers recorded:false with principal 8,425,000 cents, and accrues interest only from the tape's own paid-through date (2026-11-01) — the tape states everything before it as paid, so accrual cannot start at the 2015 origination. The quote endpoint answers 201 recorded:true with the same figure; the quote is listed. Nothing is paid, nothing is sent. This leg runs LAST so that a wrong payoff figure fails the walk without hiding the legs before it.",
      async run(ctx) {
        const a = ctx.get<string>("noteA");
        const calc = await ctx.api("GET", `/api/notes/${a}/payoff`);
        ctx.check(calc.status === 200, `payoff calculator must return 200, got ${fail(calc)}`);
        ctx.check(body(calc).recorded === false, `the calculator must not record, got recorded=${JSON.stringify(body(calc).recorded)}`);
        ctx.check(body(calc).principalCents === 8_425_000, `payoff principal must be 8425000 cents, got ${JSON.stringify(body(calc).principalCents)}`);
        const accrualStart = String(body(calc).accrualStart ?? "");
        const days = body(calc).daysAccrued;
        const interest = body(calc).accruedInterestCents;
        ctx.check(
          accrualStart >= "2026-11-01" && typeof days === "number" && days <= 60,
          `payoff interest must accrue from the tape's paid-through date 2026-11-01 (at most 60 days by now), got accrualStart=${JSON.stringify(accrualStart)} daysAccrued=${JSON.stringify(days)} accruedInterestCents=${JSON.stringify(interest)} totalPayoffCents=${JSON.stringify(body(calc).totalPayoffCents)} on principal 8425000`,
        );
        const rec = await ctx.api("POST", `/api/notes/${a}/payoff/quotes`, { payoffFeeCents: 5_000, channel: "operator_api", notes: "walk fixture" });
        ctx.check(rec.status === 201 && body(rec).recorded === true, `recording a quote must return 201 recorded:true, got ${fail(rec)}`);
        ctx.check(body(rec).totalPayoffCents >= 8_425_000, `the quote's total must be at least the principal, got ${JSON.stringify(body(rec).totalPayoffCents)}`);
        const list = await ctx.api("GET", `/api/notes/${a}/payoff/quotes`);
        ctx.check(list.status === 200, `GET payoff quotes must return 200, got ${fail(list)}`);
        const quotes = body(list).quotes ?? (Array.isArray(body(list)) ? body(list) : []);
        ctx.check(Array.isArray(quotes) && quotes.length === 1, `exactly one recorded quote must be listed, got ${JSON.stringify(body(list)).slice(0, 300)}`);
        return { observed: { calculatorTotalCents: body(calc).totalPayoffCents, recordedTotalCents: body(rec).totalPayoffCents, perDiemCents: body(rec).perDiemInterestCents, quotesListed: quotes.length } };
      },
    },
  ],
});
