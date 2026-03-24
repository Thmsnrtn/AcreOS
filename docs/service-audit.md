# AcreOS Service Completeness Audit

**Generated**: 2026-03-23
**Total service files**: 111
**Untracked (new, uncommitted)**: 11

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total service files | 111 |
| Untracked (uncommitted) | 11 |
| Files with `@ts-nocheck` | ~27 |
| Class-based singletons | ~44 |
| Function-only exports | ~67 |

---

## Core Platform

| File | Type | Description | Status |
|------|------|-------------|--------|
| emailService.ts | Singleton | AWS SES email with retry logic | OK |
| credits.ts | Singleton | Credit balance, transaction ledger | OK |
| usageLimits.ts | Functions | Tier limits, seat management, usage gates | OK |
| trialService.ts | Functions | 14-day trial start/expire/status | OK |
| dunning.ts | Singleton | Payment failure recovery sequences | OK |
| onboarding.ts | Singleton | Onboarding workflow tracking | OK |
| healthCheck.ts | Singleton | External service health checks | OK |
| encryption.ts | Functions | AES encryption/decryption | OK |
| founder.ts | Functions | Founder email detection (minimal) | OK |
| stripeConnect.ts | Singleton | Stripe Connect account management | OK |

## AI/ML Services

| File | Type | Description | Status |
|------|------|-------------|--------|
| aiRouter.ts | Functions | AI response cache, task routing | OK |
| aiContextAggregator.ts | Functions | Conversation context cache | OK |
| agentOrchestration.ts | Singleton | Multi-step agent orchestration | OK |
| aiTutor.ts | Singleton | Learning assistant | @ts-nocheck |
| visionAI.ts | Singleton | Image analysis | @ts-nocheck |
| voiceAI.ts | Singleton | Voice transcription | @ts-nocheck |
| voiceCallAI.ts | Singleton | Twilio voice call integration | OK |
| voiceLearning.ts | Singleton | Voice model training | @ts-nocheck |
| complianceAI.ts | Singleton | Compliance AI checks | @ts-nocheck |
| negotiationOrchestrator.ts | Singleton | Deal negotiation strategy | @ts-nocheck |
| agent-skills.ts | Singleton | Skill registry (~85KB) | @ts-nocheck |
| task-runner.ts | Functions | Task scheduling | @ts-nocheck |
| aiOfferService.ts | Functions | AI-generated offer analysis | OK |
| intent-router.ts | Functions | Intent classification from text | OK |

## Data Pipeline & Enrichment

| File | Type | Description | Status |
|------|------|-------------|--------|
| data-source-broker.ts | Singleton | Data source routing and caching (~79KB) | OK |
| data-source-lookup.ts | Singleton | Multi-source data discovery | OK |
| data-source-validator.ts | Singleton | Data source validation | OK |
| dataQualityMonitor.ts | Functions | Data source health probing (18 sources) | @ts-nocheck |
| dataSourceValidationJob.ts | Functions | Async validation job status | OK |
| propertyEnrichment.ts | Singleton | Property data augmentation | OK |
| parcel.ts | Functions | Parcel boundary lookup | OK |
| comps.ts | Functions | Comparable property analysis | OK |
| import.ts | Functions | CSV import parsing | OK |
| export.ts | Functions | CSV export formatting | OK |
| importExport.ts | Functions | Combined import/export utilities | OK |
| gisValidation.ts | Functions | GIS data validation | OK |
| arcgis-discovery.ts | Functions | ArcGIS endpoint discovery | OK |
| addressVerification.ts | Functions | Address validation | OK |

## CRM/Sales & Lead Management

| File | Type | Description | Status |
|------|------|-------------|--------|
| leadScoring.ts | Singleton | Betty-style lead scoring (-400 to +400) | OK |
| leadQualification.ts | Functions | Signal detection from messages | OK |
| leadNurturer.ts | Singleton | Automated lead engagement sequences | OK |
| buyerMatchingAI.ts | Singleton | Property-to-buyer matching | OK |
| buyerQualificationBot.ts | Singleton | Automated buyer qualification | OK |
| buyerNetwork.ts | Singleton | Buyer intelligence network | @ts-nocheck |
| sellerIntentPredictor.ts | Singleton | Seller behavior prediction | OK |
| campaignOptimizer.ts | Singleton | Campaign performance optimization | OK |
| sequenceProcessor.ts | Singleton | Email sequence execution | OK |
| sequenceOptimizer.ts | Singleton | Campaign sequence tuning | OK |
| dealHunter.ts | Singleton | Deal discovery | @ts-nocheck |
| dealPatternCloning.ts | Singleton | Pattern-based deal replication | OK |
| marketplace.ts | Singleton | Deal marketplace | @ts-nocheck |
| matchmaking.ts | Singleton | Buyer-seller matching | @ts-nocheck |
| communications.ts | Singleton | Multi-channel messaging | OK |
| smsService.ts | Singleton | SMS delivery | OK |
| smsProvider.ts | Functions | SMS provider abstraction | OK |
| mailProvider.ts | Functions | Email provider abstraction | OK |
| directMail.ts | Functions | Direct mail cost constants | OK |
| directMailService.ts | Functions | Direct mail campaign integration | OK |
| lobService.ts | Singleton | LOB.com direct mail API | OK |

## Financial & Valuation

| File | Type | Description | Status |
|------|------|-------------|--------|
| acreOSValuation.ts | Singleton | Property valuation model | @ts-nocheck |
| cashFlowForecaster.ts | Singleton | Financial forecasting | OK |
| financeAgent.ts | Singleton | Financial analysis automation | OK |
| capitalMarkets.ts | Singleton | Capital markets integration | @ts-nocheck |
| landCredit.ts | Singleton | Land credit scoring | @ts-nocheck |
| priceOptimizer.ts | Singleton | Dynamic pricing recommendations | OK |
| dispositionOptimizer.ts | Singleton | Property disposition strategy | OK |
| portfolioOptimizer.ts | Singleton | Portfolio strategy | @ts-nocheck |
| portfolioSentinel.ts | Singleton | Portfolio monitoring and alerts | OK |
| marketIntelligence.ts | Singleton | Market trend analysis | OK |
| marketPrediction.ts | Singleton | Market forecasting | @ts-nocheck |
| taxResearcher.ts | Singleton | Tax research integration | OK |

## Compliance & Legal

| File | Type | Description | Status |
|------|------|-------------|--------|
| tcpaCompliance.ts | Functions | TCPA consent verification | OK |
| complianceGuardian.ts | Functions | Compliance rule engine | OK |
| certification.ts | Singleton | User certification tracking | OK |

## Documents & Media

| File | Type | Description | Status |
|------|------|-------------|--------|
| documents.ts | Functions | PDF generation, signatures, annotations | OK |
| documentIntelligence.ts | Singleton | Document OCR and extraction | Refs non-existent storage methods |

## Analytics, Monitoring & Alerts

| File | Type | Description | Status |
|------|------|-------------|--------|
| betaAnalytics.ts | Functions | Beta activation event tracking | @ts-nocheck |
| activityLogger.ts | Singleton | Event logging and telemetry | OK |
| alerting.ts | Singleton | Alert triggering system | OK |
| realtimeAlerts.ts | Singleton | Real-time alerting | @ts-nocheck |
| externalStatusMonitor.ts | Functions | External service monitoring | OK |
| proactiveMonitor.ts | Singleton | Proactive issue detection | OK |
| sophieObserver.ts | Singleton | System behavior monitoring | OK |
| sophieLearning.ts | Functions | Reinforcement learning | @ts-nocheck |
| digest.ts | Functions | Digest compilation | OK |
| apiQueue.ts | Singleton | API request queuing/rate limiting | OK |
| jobQueue.ts | Singleton | Job queue management | OK |

## Autonomy & Operations (Untracked — Phase 5-9)

| File | Type | Description | Status |
|------|------|-------------|--------|
| claudeIntelligence.ts | Singleton | Claude API synthesis (product/marketing/strategy) | NEW |
| koldlyClient.ts | Singleton | Ecosystem conversion signal bridge | NEW |
| lifecyclePrompts.ts | Singleton | P3-P9 lifecycle prompt library | NEW |
| messagingEvolution.ts | Singleton | VOC ingestion, divergence scan | NEW |
| onboardingAutomation.ts | Singleton | Stuck detection, adaptive help, A/B testing | NEW |
| operationScheduler.ts | Singleton | Cron orchestrator (daily/weekly/monthly) | NEW |
| retentionEngine.ts | Singleton | Churn scoring, intervention sequences | NEW |
| revenueOps.ts | Singleton | Trial conversion, expansion, revenue-at-risk | NEW |
| safetyGates.ts | Singleton | Gate system (0-4), autonomy promotion | NEW |
| supportEnhancement.ts | Singleton | Deflection, KB auto-gen, pattern detection | NEW |
| weeklyDigest.ts | Singleton | Weekly digest compilation | NEW |

## Other/System

| File | Type | Description | Status |
|------|------|-------------|--------|
| whiteLabelService.ts | Singleton | White-label customization | @ts-nocheck |
| workflow-engine.ts | Singleton | Workflow orchestration | @ts-nocheck |
| browserAutomation.ts | Functions | Puppeteer automation | @ts-nocheck |
| contextProfile.ts | Singleton | User/org context profile | OK |
| skill-permissions.ts | Functions | Agent skill action registry | OK |
| core-agents.ts | Functions | Core agent definitions | OK |
| acquisitionRadar.ts | Singleton | Deal acquisition intelligence | OK |
| dueDiligence.ts | Functions | Due diligence research | OK |
| dueDiligencePods.ts | Singleton | Coordinated due diligence workflows | OK |
| education.ts | Singleton | Educational content | @ts-nocheck |
| negotiationCopilot.ts | Singleton | Negotiation assistance | OK |
| writingStyle.ts | Functions | Writing style analysis | OK |
| supportBrain.ts | Singleton | Support knowledge base | OK |

---

## Key Findings

1. **~27 files use `@ts-nocheck`** — type safety is suppressed. These should be audited for runtime correctness.
2. **11 untracked files** are fully implemented autonomy/operations services, not stubs.
3. **documentIntelligence.ts** references `storage.getSupportCase()` and `storage.getSupportMessages()` which don't exist in the storage interface.
4. **No stubs found** — all 111 files have substantive implementations.
5. **No hardcoded credentials** found in spot checks.
6. **No TODO/FIXME/HACK** markers found.
