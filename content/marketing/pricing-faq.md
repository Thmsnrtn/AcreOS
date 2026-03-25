# AcreOS Pricing FAQ

## 1. What happens to my data if I cancel?

Your data stays. When you downgrade to the Free tier, all your leads, deals, properties, notes, and documents are preserved. You can access and export everything. You just lose access to Pro/Starter features like the Deal Feed, DD reports, and AI tools. If you upgrade again later, everything is right where you left it.

## 2. Can I switch plans anytime?

Yes. Upgrade or downgrade at any time from Settings → Billing. Upgrades take effect immediately — you're prorated for the remaining billing period. Downgrades take effect at the end of your current billing period so you don't lose access mid-cycle.

## 3. Do you offer monthly and annual billing?

Monthly billing is available on all plans. Annual billing is coming soon and will include a 2-month discount (pay for 10 months, get 12).

## 4. What's BYOK?

Bring Your Own Key. On the Pro plan, you can connect your own API keys for premium data providers (Regrid, ATTOM, BatchData). When you use your own keys, you bypass AcreOS credit charges for those lookups — the data costs go directly to your provider account. This is ideal for high-volume users who want unlimited lookups at provider-direct pricing.

## 5. How does the free trial work?

When you sign up, you get 90 days of full Pro access — every feature, no restrictions. No credit card required to start. At the end of 90 days, your account moves to the Free tier. You can upgrade to Starter or Pro at any point during or after the trial.

## 6. Can I have multiple users on the Free plan?

The Free plan supports 1 user. Team features (additional seats, role-based permissions, team messaging) are available on the Starter plan (up to 3 users) and Pro plan (up to 10 users, additional seats available).

## 7. What integrations are available?

AcreOS integrates with:
- **Stripe** — payment processing for note payments and subscriptions
- **AWS SES** — email sending (or bring your own SES credentials)
- **Twilio / Telnyx** — SMS (platform or bring your own account)
- **Google Calendar** — sync closings, follow-ups, and property visits
- **Google Drive** — document storage sync
- **Regrid, ATTOM, BatchData** — premium data providers (BYOK on Pro)
- **Webhooks** — 30+ event types for custom integrations
- **CSV import/export** — universal data portability

## 8. Is my data secure?

Yes. AcreOS uses field-level encryption (AES-256) for sensitive data, HTTPS-only transport, SQL injection prevention via parameterized queries, input validation on all endpoints, and role-based access control. Your data is isolated by organization — no other user or organization can access it. See our full security documentation at docs/security-posture.md.

## 9. Do you have an API?

Yes. AcreOS has a comprehensive REST API covering leads, properties, deals, notes, payments, campaigns, and intelligence features. API documentation is available at docs/api-reference.md. API access is available on all plans.

## 10. What data sources are included?

AcreOS integrates 18 free government data sources for property due diligence:
FEMA (flood zones), USGS (elevation), USDA (soil, land values), Census (demographics, population), EPA (environmental), USFWS (wetlands, endangered species), BLM (public lands), NLCD (land cover), NOAA (climate), OpenStreetMap (roads), NREL (solar), USFS (wildfire), and SSURGO (detailed soil). All 18 are available on the Starter and Pro plans.

## 11. What's the Land Credit Score?

The Land Credit Score (LCS) is a proprietary 300-850 rating that assesses a parcel's investment quality across 6 dimensions: flood risk, soil quality, road access, utility availability, topography, and environmental factors. Think of it like a FICO score for land. Higher scores indicate better investment potential. The score is transparent — you can see exactly which dimensions contributed to the rating and why.

## 12. Do you support seller-financed notes?

Yes — AcreOS has full seller-finance note management. Create notes with custom terms (down payment, interest rate, term, balloon). Get automatic amortization schedules, payment tracking, borrower portal (your buyers can view their balance and make payments), Dodd-Frank compliance checking, and automated dunning sequences when payments are late. Note management is available on the Pro plan.

## 13. Can I import from Pebble or REsimpli?

Yes. Export your data from Pebble or REsimpli as CSV, then use AcreOS's import tool (Leads → Import). The importer automatically maps common field names. For any fields that don't auto-map, you can manually assign them during import. All your lead data, including custom fields, notes, and status history, can be brought over.

## 14. Do you offer refunds?

If you're not satisfied within the first 30 days of a paid subscription, email us for a full refund. After 30 days, we don't offer refunds, but you can cancel anytime and your subscription will remain active through the end of the billing period.

## 15. Is there a mobile app?

AcreOS has a mobile-responsive web app that works on any phone or tablet browser. A native mobile app (iOS and Android) via Capacitor is built and in testing — it will be available on the App Store and Google Play soon. The native app provides offline access to your Deal Feed and the ability to queue actions while offline.
