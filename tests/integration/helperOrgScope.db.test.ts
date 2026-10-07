/**
 * Storage and service helpers that address a row by its own id or by its
 * parent's id take the organization as a REQUIRED argument and carry it in the
 * statement — directly where the table has an organization column, and through
 * the org-owned parent where it does not (deal checklists, due-diligence items,
 * sequence steps and enrollments, A/B variants, AI messages, Pax project files,
 * mailing pieces, workflow runs, support messages).
 *
 * Against a real database built from the repo, because the property is a WHERE
 * clause and only Postgres evaluates one. Two organizations are created; every
 * row belongs to A. Each helper is called twice with A's row id: once as B,
 * which must read nothing and write nothing, and once as A, which must work —
 * so an empty answer cannot pass by the helper being broken for everyone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("helperOrgScope.db");

describe.runIf(realDbAvailable)("by-id and by-parent helpers act within the organization", () => {
  let storage: typeof import("../../server/storage").storage;
  let db: typeof import("../../server/db").db;
  let s: typeof import("../../shared/schema");
  let eq: typeof import("drizzle-orm").eq;
  let inArray: typeof import("drizzle-orm").inArray;
  let portfolioSentinel: typeof import("../../server/services/portfolioSentinel").portfolioSentinelService;
  let checkDealAmlPatterns: typeof import("../../server/services/amlMonitor").checkDealAmlPatterns;
  let dispositionOptimizer: typeof import("../../server/services/dispositionOptimizer").dispositionOptimizerService;

  const tag = `helperscope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let A = 0;
  let B = 0;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    ({ storage } = await import("../../server/storage"));
    ({ db } = await import("../../server/db"));
    s = await import("../../shared/schema");
    ({ eq, inArray } = await import("drizzle-orm"));
    ({ portfolioSentinelService: portfolioSentinel } = await import("../../server/services/portfolioSentinel"));
    ({ checkDealAmlPatterns } = await import("../../server/services/amlMonitor"));
    ({ dispositionOptimizerService: dispositionOptimizer } = await import("../../server/services/dispositionOptimizer"));

    const [a] = await db.insert(s.organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-owner-a` }).returning();
    const [b] = await db.insert(s.organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-owner-b` }).returning();
    A = a.id;
    B = b.id;

    const [prop] = await db.insert(s.properties).values({
      organizationId: A, apn: `${tag}-apn`, county: "Llano", state: "TX", sizeAcres: "10",
      purchasePrice: "1000", purchaseDate: new Date(),
      dueDiligenceData: { taxesCurrent: false },
    } as never).returning();
    ids.property = prop.id;
    const [lead] = await db.insert(s.leads).values({ organizationId: A, firstName: "Ada", lastName: tag }).returning();
    ids.lead = lead.id;
    const [deal] = await db.insert(s.deals).values({ organizationId: A, propertyId: prop.id, type: "acquisition" } as never).returning();
    ids.deal = deal.id;
    const [note] = await db.insert(s.notes).values({
      organizationId: A, originalPrincipal: "10000", currentBalance: "10000", interestRate: "8",
      termMonths: 60, monthlyPayment: "200", startDate: new Date(), firstPaymentDate: new Date(),
      status: "pending",
    } as never).returning();
    ids.note = note.id;

    // due-diligence + deal checklist
    const [item] = await db.insert(s.dueDiligenceItems).values({ propertyId: prop.id, itemName: `${tag}-item`, category: "title", notes: "original" }).returning();
    ids.ddItem = item.id;
    const [tpl] = await db.insert(s.dueDiligenceTemplates).values({ organizationId: A, name: `${tag}-tpl`, items: [] as never }).returning();
    ids.ddTemplate = tpl.id;
    const [checklist] = await db.insert(s.dealChecklists).values({
      dealId: deal.id,
      items: [{ id: "req-1", title: "Required item", required: true, documentRequired: false }] as never,
    }).returning();
    ids.checklist = checklist.id;

    // vaEngine / borrower messages / reminders
    await db.insert(s.adPostings).values({
      organizationId: A, propertyId: prop.id, platform: "facebook", title: tag, description: tag, listingPrice: "1000",
    } as never);
    await db.insert(s.borrowerMessages).values({ orgId: A, noteId: note.id, senderType: "lender", content: tag } as never);
    await db.insert(s.paymentReminders).values({ organizationId: A, noteId: note.id, type: "upcoming", scheduledFor: new Date() } as never);

    // sequences + A/B
    const [seq] = await db.insert(s.campaignSequences).values({ organizationId: A, name: `${tag}-seq` } as never).returning();
    ids.sequence = seq.id;
    await db.insert(s.sequenceSteps).values({ sequenceId: seq.id, stepNumber: 1, channel: "email", content: tag } as never);
    const [enr] = await db.insert(s.sequenceEnrollments).values({ sequenceId: seq.id, leadId: lead.id, status: "active" } as never).returning();
    ids.enrollment = enr.id;
    const [camp] = await db.insert(s.campaigns).values({ organizationId: A, name: `${tag}-camp`, type: "direct_mail" } as never).returning();
    ids.campaign = camp.id;
    const [test] = await db.insert(s.abTests).values({ organizationId: A, campaignId: camp.id, name: `${tag}-ab`, testType: "subject" } as never).returning();
    ids.abTest = test.id;
    const [variant] = await db.insert(s.abTestVariants).values({ testId: test.id, name: "control" } as never).returning();
    ids.variant = variant.id;

    // ai / pax / mail / workflows / documents / va / support
    const [conv] = await db.insert(s.aiConversations).values({ organizationId: A, userId: `${tag}-u`, title: tag } as never).returning();
    ids.conversation = conv.id;
    await db.insert(s.aiMessages).values({ conversationId: conv.id, role: "user", content: tag });
    const [proj] = await db.insert(s.paxProjects).values({ organizationId: A, userId: `${tag}-u`, name: tag } as never).returning();
    ids.project = proj.id;
    await db.insert(s.paxProjectFiles).values({
      projectId: proj.id, fileName: "f.txt", mimeType: "text/plain", sizeBytes: 1, extractedContent: tag, uploadedBy: `${tag}-u`,
    });
    const [order] = await db.insert(s.mailingOrders).values({ organizationId: A, mailType: "postcard" } as never).returning();
    ids.order = order.id;
    await db.insert(s.mailingOrderPieces).values({
      mailingOrderId: order.id, recipientName: tag, recipientAddressLine1: "1 Main", recipientCity: "Llano",
      recipientState: "TX", recipientZipCode: "78643",
    } as never);
    const [wf] = await db.insert(s.workflows).values({ organizationId: A, name: tag, trigger: {} as never, actions: [] as never } as never).returning();
    ids.workflow = wf.id;
    await db.insert(s.workflowRuns).values({ workflowId: wf.id } as never);
    const [doc] = await db.insert(s.generatedDocuments).values({ organizationId: A, name: tag, type: "contract" } as never).returning();
    ids.document = doc.id;
    await db.insert(s.signatures).values({ organizationId: A, documentId: doc.id, signerName: "Ada", signatureData: "data:," } as never);
    const [agent] = await db.insert(s.vaAgents).values({ organizationId: A, agentType: "acquisitions", name: tag } as never).returning();
    ids.vaAgent = agent.id;
    const [action] = await db.insert(s.vaActions).values({
      organizationId: A, agentId: agent.id, actionType: "send_email", category: "outreach", title: tag, input: {} as never,
    } as never).returning();
    ids.vaAction = action.id;
    const [sc] = await db.insert(s.supportCases).values({ organizationId: A, userId: `${tag}-u`, subject: "original" } as never).returning();
    ids.supportCase = sc.id;
    await db.insert(s.supportMessages).values({ caseId: sc.id, role: "user", content: tag } as never);
    const [alert] = await db.insert(s.systemAlerts).values({
      organizationId: A, type: "revenue_at_risk", title: tag, message: tag, status: "new",
    } as never).returning();
    ids.systemAlert = alert.id;
  });

  afterAll(async () => {
    if (!A) return;
    const orgs = [A, B];
    await db.delete(s.supportMessages).where(eq(s.supportMessages.caseId, ids.supportCase ?? -1));
    await db.delete(s.supportActions).where(eq(s.supportActions.caseId, ids.supportCase ?? -1));
    await db.delete(s.supportCases).where(inArray(s.supportCases.organizationId, orgs));
    await db.delete(s.systemAlerts).where(inArray(s.systemAlerts.organizationId, orgs));
    await db.delete(s.vaActions).where(inArray(s.vaActions.organizationId, orgs));
    await db.delete(s.vaAgents).where(inArray(s.vaAgents.organizationId, orgs));
    await db.delete(s.signatures).where(inArray(s.signatures.organizationId, orgs));
    await db.delete(s.generatedDocuments).where(inArray(s.generatedDocuments.organizationId, orgs));
    await db.delete(s.workflowRuns).where(eq(s.workflowRuns.workflowId, ids.workflow ?? -1));
    await db.delete(s.workflows).where(inArray(s.workflows.organizationId, orgs));
    await db.delete(s.mailingOrderPieces).where(eq(s.mailingOrderPieces.mailingOrderId, ids.order ?? -1));
    await db.delete(s.mailingOrders).where(inArray(s.mailingOrders.organizationId, orgs));
    await db.delete(s.paxProjectFiles).where(eq(s.paxProjectFiles.projectId, ids.project ?? -1));
    await db.delete(s.paxProjects).where(inArray(s.paxProjects.organizationId, orgs));
    await db.delete(s.aiMessages).where(eq(s.aiMessages.conversationId, ids.conversation ?? -1));
    await db.delete(s.aiConversations).where(inArray(s.aiConversations.organizationId, orgs));
    await db.delete(s.abTestVariants).where(eq(s.abTestVariants.testId, ids.abTest ?? -1));
    await db.delete(s.abTests).where(inArray(s.abTests.organizationId, orgs));
    await db.delete(s.campaigns).where(inArray(s.campaigns.organizationId, orgs));
    await db.delete(s.sequenceEnrollments).where(eq(s.sequenceEnrollments.sequenceId, ids.sequence ?? -1));
    await db.delete(s.sequenceSteps).where(eq(s.sequenceSteps.sequenceId, ids.sequence ?? -1));
    await db.delete(s.campaignSequences).where(inArray(s.campaignSequences.organizationId, orgs));
    await db.delete(s.paymentReminders).where(inArray(s.paymentReminders.organizationId, orgs));
    await db.delete(s.borrowerMessages).where(inArray(s.borrowerMessages.orgId, orgs));
    await db.delete(s.adPostings).where(inArray(s.adPostings.organizationId, orgs));
    await db.delete(s.dealChecklists).where(eq(s.dealChecklists.dealId, ids.deal ?? -1));
    await db.delete(s.dueDiligenceItems).where(eq(s.dueDiligenceItems.propertyId, ids.property ?? -1));
    await db.delete(s.dueDiligenceTemplates).where(inArray(s.dueDiligenceTemplates.organizationId, orgs));
    await db.delete(s.portfolioAlerts).where(inArray(s.portfolioAlerts.organizationId, orgs));
    await db.delete(s.agentEvents).where(inArray(s.agentEvents.organizationId, orgs));
    await db.delete(s.deals).where(inArray(s.deals.organizationId, orgs));
    await db.delete(s.notes).where(inArray(s.notes.organizationId, orgs));
    await db.delete(s.leads).where(inArray(s.leads.organizationId, orgs));
    await db.delete(s.properties).where(inArray(s.properties.organizationId, orgs));
    await db.delete(s.organizations).where(inArray(s.organizations.id, orgs));
  });

  it("dueDiligenceRepo: items, templates and deal checklists", async () => {
    expect(await storage.getPropertyDueDiligence(B, ids.property)).toEqual([]);
    expect((await storage.getPropertyDueDiligence(A, ids.property)).map((r) => r.id)).toEqual([ids.ddItem]);

    expect(await storage.updateDueDiligenceItem(B, ids.ddItem, { notes: "changed-by-b" })).toBeUndefined();
    await storage.deleteDueDiligenceItem(B, ids.ddItem);
    const [itemRow] = await db.select().from(s.dueDiligenceItems).where(eq(s.dueDiligenceItems.id, ids.ddItem));
    expect(itemRow?.notes, "B's update and delete must leave A's item untouched").toBe("original");
    expect((await storage.updateDueDiligenceItem(A, ids.ddItem, { notes: "changed-by-a" }))?.notes).toBe("changed-by-a");

    expect(await storage.updateDueDiligenceTemplate(B, ids.ddTemplate, { name: "by-b" })).toBeUndefined();
    expect((await storage.updateDueDiligenceTemplate(A, ids.ddTemplate, { name: `${tag}-renamed` }))?.name).toBe(`${tag}-renamed`);

    expect(await storage.getDealChecklist(B, ids.deal)).toBeUndefined();
    expect((await storage.getDealChecklist(A, ids.deal))?.id).toBe(ids.checklist);
    expect(await storage.updateDealChecklist(B, ids.checklist, { items: [] })).toBeUndefined();
    // B sees no checklist on A's deal, so nothing gates it; A sees the
    // required item, untouched by B's write.
    expect((await storage.checkStageGate(B, ids.deal)).incompleteItems).toEqual([]);
    const gateA = await storage.checkStageGate(A, ids.deal);
    expect(gateA.canAdvance).toBe(false);
    expect(gateA.incompleteItems.map((i) => i.id)).toEqual(["req-1"]);
    await expect(storage.updateDealChecklistItem(B, ids.deal, "req-1", { checked: true })).rejects.toThrow(/not found/i);
  });

  it("vaEngineRepo, growthConfigRepo, paymentRemindersRepo: by-parent reads", async () => {
    expect(await storage.getAdPostingsByProperty(B, ids.property)).toEqual([]);
    expect(await storage.getAdPostingsByProperty(A, ids.property)).toHaveLength(1);
    expect(await storage.getBorrowerMessages(B, ids.note)).toEqual([]);
    expect(await storage.getBorrowerMessages(A, ids.note)).toHaveLength(1);
    expect(await storage.getRemindersForNote(B, ids.note)).toEqual([]);
    expect(await storage.getRemindersForNote(A, ids.note)).toHaveLength(1);
  });

  it("sequencesRepo: steps, enrollments, A/B tests and variants", async () => {
    expect(await storage.getSequenceSteps(B, ids.sequence)).toEqual([]);
    expect(await storage.getSequenceSteps(A, ids.sequence)).toHaveLength(1);
    expect(await storage.getSequenceEnrollment(B, ids.enrollment)).toBeUndefined();
    expect(await storage.updateSequenceEnrollment(B, ids.enrollment, { status: "cancelled" })).toBeUndefined();
    expect((await storage.getSequenceEnrollment(A, ids.enrollment))?.status, "B's write must not land").toBe("active");
    expect((await storage.pauseEnrollment(A, ids.enrollment, "test"))?.status).toBe("paused");
    expect(await storage.getLeadEnrollments(B, ids.lead)).toEqual([]);
    expect(await storage.getLeadEnrollments(A, ids.lead)).toHaveLength(1);

    expect(await storage.getAbTestByCampaign(B, ids.campaign)).toBeUndefined();
    expect((await storage.getAbTestByCampaign(A, ids.campaign))?.id).toBe(ids.abTest);
    expect(await storage.getAbTestVariants(B, ids.abTest)).toEqual([]);
    expect(await storage.updateAbTestVariant(B, ids.variant, { name: "by-b" })).toBeUndefined();
    expect((await storage.updateAbTestVariant(A, ids.variant, { name: "by-a" }))?.name).toBe("by-a");
  });

  it("aiRepo, paxRepo, mailRepo, agentWorkflowsRepo, documentsRepo: children of an org-owned parent", async () => {
    expect(await storage.getAiMessages(B, ids.conversation)).toEqual([]);
    expect(await storage.getAiMessages(A, ids.conversation)).toHaveLength(1);
    expect(await storage.getPaxProjectFiles(B, ids.project)).toEqual([]);
    expect(await storage.getPaxProjectFiles(A, ids.project)).toHaveLength(1);
    expect(await storage.getMailingOrderPieces(B, ids.order)).toEqual([]);
    expect(await storage.getMailingOrderPieces(A, ids.order)).toHaveLength(1);
    expect(await storage.getWorkflowRuns(B, ids.workflow)).toEqual([]);
    expect(await storage.getWorkflowRuns(A, ids.workflow)).toHaveLength(1);
    expect(await storage.getDocumentSignatures(B, ids.document)).toEqual([]);
    expect(await storage.getDocumentSignatures(A, ids.document)).toHaveLength(1);
  });

  it("vaRepo and supportOpsRepo: by-id reads and writes", async () => {
    expect(await storage.getVaAction(B, ids.vaAction)).toBeUndefined();
    expect((await storage.getVaAction(A, ids.vaAction))?.id).toBe(ids.vaAction);

    expect(await storage.getSupportMessages(B, ids.supportCase)).toEqual([]);
    expect(await storage.getSupportMessages(A, ids.supportCase)).toHaveLength(1);
    expect(await storage.updateSupportCase(B, ids.supportCase, { subject: "by-b" })).toBeUndefined();
    expect((await storage.getSupportCase(A, ids.supportCase))?.subject).toBe("original");
    expect((await storage.updateSupportCase(A, ids.supportCase, { subject: "by-a" }))?.subject).toBe("by-a");

    expect(await storage.updateSystemAlert(B, ids.systemAlert, { status: "resolved" })).toBeUndefined();
    const [alertRow] = await db.select().from(s.systemAlerts).where(eq(s.systemAlerts.id, ids.systemAlert));
    expect(alertRow.status).toBe("new");
    expect((await storage.updateSystemAlert(A, ids.systemAlert, { status: "acknowledged" }))?.status).toBe("acknowledged");
  });

  it("services: portfolioSentinel, amlMonitor and dispositionOptimizer read the property or deal within the organization", async () => {
    // A's property reports delinquent taxes; B asking about it learns nothing
    // and raises no alert.
    expect(await portfolioSentinel.checkTaxStatus(B, ids.property)).toBe(false);
    expect(await db.select().from(s.portfolioAlerts).where(eq(s.portfolioAlerts.organizationId, B))).toEqual([]);
    expect(await portfolioSentinel.checkTaxStatus(A, ids.property)).toBe(true);

    // Rapid-flip needs the deal's property; B reading A's deal sees neither.
    const flagsB = await checkDealAmlPatterns(B, ids.deal, 9000);
    expect(flagsB.map((f) => f.pattern)).not.toContain("rapid_flip");
    const flagsA = await checkDealAmlPatterns(A, ids.deal, 9000);
    expect(flagsA.map((f) => f.pattern)).toContain("rapid_flip");

    await expect(dispositionOptimizer.calculateOptimalPrice(B, ids.property)).rejects.toThrow(/not found/);
    await expect(dispositionOptimizer.analyzeTimingFactors(B, ids.property)).rejects.toThrow(/not found/);
    const pricing = await dispositionOptimizer.calculateOptimalPrice(A, ids.property);
    expect(typeof pricing.recommendedPrice).toBe("number");
  });
  it("children with no organization column: steps, enrollments, variants, support actions, template application, cascading deletes", async () => {
    // Two steps so a reorder is visible.
    const [step1] = await db.insert(s.sequenceSteps)
      .values({ sequenceId: ids.sequence, stepNumber: 2, channel: "email", content: `${tag}-s1` } as never).returning();
    const [step2] = await db.insert(s.sequenceSteps)
      .values({ sequenceId: ids.sequence, stepNumber: 3, channel: "email", content: `${tag}-s2` } as never).returning();
    const stepNumber = async (id: number) =>
      (await db.select().from(s.sequenceSteps).where(eq(s.sequenceSteps.id, id)))[0]?.stepNumber;

    expect(await storage.updateSequenceStep(B, step1.id, { content: "by-b" })).toBeUndefined();
    expect((await db.select().from(s.sequenceSteps).where(eq(s.sequenceSteps.id, step1.id)))[0].content).toBe(`${tag}-s1`);
    expect((await storage.updateSequenceStep(A, step1.id, { content: "by-a" }))?.content).toBe("by-a");

    await storage.reorderSequenceSteps(B, ids.sequence, [step2.id, step1.id]);
    expect([await stepNumber(step2.id), await stepNumber(step1.id)], "B's reorder must not land").toEqual([3, 2]);
    await storage.reorderSequenceSteps(A, ids.sequence, [step2.id, step1.id]);
    expect([await stepNumber(step2.id), await stepNumber(step1.id)]).toEqual([1, 2]);

    await storage.deleteSequenceStep(B, step2.id);
    expect(await stepNumber(step2.id), "B's delete must leave A's step").toBe(1);
    await storage.deleteSequenceStep(A, step2.id);
    expect(await stepNumber(step2.id)).toBeUndefined();

    expect(await storage.getSequenceEnrollments(B, ids.sequence)).toEqual([]);
    expect(await storage.getSequenceEnrollments(A, ids.sequence)).toHaveLength(1);

    const [v2] = await db.insert(s.abTestVariants).values({ testId: ids.abTest, name: `${tag}-v2` } as never).returning();
    await storage.deleteAbTestVariant(B, v2.id);
    expect(await db.select().from(s.abTestVariants).where(eq(s.abTestVariants.id, v2.id))).toHaveLength(1);
    await storage.deleteAbTestVariant(A, v2.id);
    expect(await db.select().from(s.abTestVariants).where(eq(s.abTestVariants.id, v2.id))).toHaveLength(0);

    await db.insert(s.supportActions).values({
      caseId: ids.supportCase, actionType: "lookup", performedBy: "ai", success: true,
    } as never);
    expect(await storage.getSupportActions(B, ids.supportCase)).toEqual([]);
    expect(await storage.getSupportActions(A, ids.supportCase)).toHaveLength(1);

    // Template application deletes the property's items before writing the
    // template's: B, with a template of its own, must not reach A's property.
    const tplItems = [{ id: "i1", name: `${tag}-tpl-item`, category: "title", required: true }];
    const [tplB] = await db.insert(s.dueDiligenceTemplates).values({ organizationId: B, name: `${tag}-tpl-b`, items: tplItems as never }).returning();
    const [tplA] = await db.insert(s.dueDiligenceTemplates).values({ organizationId: A, name: `${tag}-tpl-a`, items: tplItems as never }).returning();
    const before = (await db.select().from(s.dueDiligenceItems).where(eq(s.dueDiligenceItems.propertyId, ids.property))).map((r) => r.id);
    expect(before.length).toBeGreaterThan(0);
    await expect(storage.applyTemplateToProperty(B, ids.property, tplB.id)).rejects.toThrow(/not found/i);
    const afterB = (await db.select().from(s.dueDiligenceItems).where(eq(s.dueDiligenceItems.propertyId, ids.property))).map((r) => r.id);
    expect(afterB, "B's template application must leave A's items in place").toEqual(before);
    const applied = await storage.applyTemplateToProperty(A, ids.property, tplA.id);
    expect(applied.map((i) => i.itemName)).toEqual([`${tag}-tpl-item`]);

    // Cascading deletes: B's attempt removes nothing, A's removes the parent
    // and its children.
    await storage.deleteSequence(B, ids.sequence);
    await storage.deleteAbTest(B, ids.abTest);
    expect(await db.select().from(s.campaignSequences).where(eq(s.campaignSequences.id, ids.sequence))).toHaveLength(1);
    expect(await db.select().from(s.sequenceSteps).where(eq(s.sequenceSteps.sequenceId, ids.sequence))).not.toHaveLength(0);
    expect(await db.select().from(s.sequenceEnrollments).where(eq(s.sequenceEnrollments.sequenceId, ids.sequence))).toHaveLength(1);
    expect(await db.select().from(s.abTests).where(eq(s.abTests.id, ids.abTest))).toHaveLength(1);
    expect(await db.select().from(s.abTestVariants).where(eq(s.abTestVariants.testId, ids.abTest))).toHaveLength(1);
    await storage.deleteSequence(A, ids.sequence);
    await storage.deleteAbTest(A, ids.abTest);
    expect(await db.select().from(s.campaignSequences).where(eq(s.campaignSequences.id, ids.sequence))).toHaveLength(0);
    expect(await db.select().from(s.sequenceSteps).where(eq(s.sequenceSteps.sequenceId, ids.sequence))).toHaveLength(0);
    expect(await db.select().from(s.abTests).where(eq(s.abTests.id, ids.abTest))).toHaveLength(0);
    expect(await db.select().from(s.abTestVariants).where(eq(s.abTestVariants.testId, ids.abTest))).toHaveLength(0);
  });
});
