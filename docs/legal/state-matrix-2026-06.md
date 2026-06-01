# AcreOS 50-State Regulatory Matrix — June 2026 Snapshot

**Author:** Beatrice Whitfield, Chief Risk Officer
**Effective:** 2026-06-01
**Cadence:** Refreshed monthly; the cells below are current as of June 2026.

## Scope

This matrix gates **Phase 1+ geographic expansion**, not Phase 0. Phase 0 is a trickle launch and operates AcreOS as a software tool nationwide. No state-specific licensing posture is required to ship at Phase 0 because AcreOS is not (a) a broker, (b) a lender, (c) a servicer of record, (d) an investment adviser, or (e) a consumer reporting agency. The matrix below documents what *will* gate at scale.

## Covered states (priority tier — June 2026)

| State | Statutes implicated | AcreOS surface | Posture | Remediation if needed |
|---|---|---|---|---|
| **California** | CCPA §1798.100–199.100 (as amended by CPRA 2020); CA Civil Code §22576 (privacy policy posting); SB 1001 (Bot Disclosure Law, BPC §17940); AB 2273 (Age-Appropriate Design Code — applies only to services likely to be accessed by minors); CCPA §1798.140(ae) (sensitive PI) | Landing, onboarding, Pax, signup form | **PASS for Phase 0.** Privacy policy lists CCPA rights (§7 of policy). SB 1001 satisfied — Pax is named at first interaction in the onboarding intro and the landing copy. AB 2273 not implicated (ToS §4 requires 18+; product is B2B). | None for Phase 0. AB 2273 must be re-evaluated if AcreOS ever surfaces a consumer-facing land-search tool open to under-18 users. |
| **Colorado** | CO SB 24-205 (Colorado AI Act, effective 2026-02-01) — disclosure requirements for high-risk AI systems and consumer-facing AI; CO Privacy Act (CPA) §6-1-1301 et seq. | Pax (high-risk AI question pending), landing AI copy, onboarding | **NEEDS-REMEDIATION.** AcreOS discloses "AI assistant" at first interaction (ToS §3, Privacy §4), but SB 24-205 §6-1-1703 requires *the deployer* to provide a statement on the AI system, its purpose, and how to contact the deployer. AcreOS satisfies "purpose + contact" via ToS §3 + privacy@acreos.io. CO classifies AI as "high-risk" when it makes a "consequential decision." Pax surfaces data and drafts; the operator decides. Posture: low-risk classification holds, but a CO-specific consumer notice link at first Pax interaction strengthens the position. | Add a CO-resident-specific notice on the Pax disclosure step (Phase 0 minor; Phase 1 required before CO paid acquisition launches). |
| **Utah** | UT Consumer Privacy Act (UCPA, §13-61-101 et seq., effective 2023-12-31) | All customer data flows | **PASS.** UCPA applies only to controllers with $25M+ revenue OR 100k+ consumers — neither threshold met at Phase 0. Privacy policy nonetheless honors UCPA rights for portability/deletion (Privacy §7). | None. Monitor threshold at Phase 2+. |
| **Connecticut** | CT Data Privacy Act (CTDPA, §42-515 et seq., effective 2023-07-01) | All customer data flows | **PASS.** Threshold-gated; not met at Phase 0. Policy supports CTDPA rights generically. | None. Monitor threshold. |
| **Texas** | TX Data Privacy and Security Act (DPSA, §541.001 et seq., effective 2024-07-01); TX HB 18 (Securing Children Online through Parental Empowerment Act, 2024); TX HB 4181 (AI Advisory Council); TX Capture or Use of Biometric Identifier Act §503.001 | Customer data, onboarding (no biometrics), no minors | **PASS.** TX DPSA applies to controllers that "conduct business in TX and process PI of TX residents" — applies, no revenue threshold. AcreOS complies: privacy notice §7 lists data-subject rights; no sale of PI; sensitive PI is not collected. HB 18 not implicated (B2B, 18+). Biometric not collected. | None for Phase 0. |
| **Illinois** | IL Biometric Information Privacy Act (BIPA, 740 ILCS 14); IL AI Video Interview Act (820 ILCS 42); IL HB 2223 (proposed AI in hiring) | None — AcreOS does no biometric capture, no video interviewing | **PASS.** BIPA's most plaintiff-rich statute in the US. AcreOS does not collect face/iris/voice/fingerprint biometrics. E-signature audit logs use IP + user-agent, not biometric data. | None. Hard rule: never add biometric capture without Beatrice signoff. |
| **Virginia** | VA Consumer Data Protection Act (CDPA, §59.1-575 et seq., effective 2023-01-01) | Customer data | **PASS.** Threshold-gated (100k+ consumers or 25k+ consumers w/ ≥50% revenue from PI sale). Not met. Policy supports CDPA rights generically. | None. Monitor threshold. |

## Federal cross-references (apply in every state)

| Statute | Status | Notes |
|---|---|---|
| FTC Act §5 (15 U.S.C. §45) | Active | Truth-engine + content controls are the primary defense. |
| CAN-SPAM §5 (15 U.S.C. §7704) | Active | Physical-postal-address gap on email footer — Phase 1 prerequisite (gated on LLC registered agent). |
| TCPA (47 U.S.C. §227) | Active | No autodialer in product. Auto-send pathway routes to Lob print only — verified in May 31 audit. |
| E-SIGN §101(c) (15 U.S.C. §7001(c)) | Active | Implemented; consent + audit retention 7y. |
| Reg Z §1026.43(c) | Active | ATR gate live for note origination. |
| GLBA (15 U.S.C. §6801) | Watching | Triggers only if AcreOS becomes a "financial institution" — currently a software tool. |
| FCRA (15 U.S.C. §1681) | Out of scope | AcreOS uses public + skip-trace data; does not produce consumer reports. |
| Fair Housing Act (42 U.S.C. §3604) | Active | Land parcels largely outside FHA residential scope; banned-use clause in ToS §8 covers discrimination. |

## What gates Phase 1+

1. **CO-specific AI notice** before paid acquisition opens in Colorado.
2. **LLC + registered-agent address** added to outbound email footer (CAN-SPAM §5(a)(3)) and ToS §20 / Privacy §16.
3. **State licensing review** if AcreOS ever (a) takes custody of borrower funds (servicing license per state), (b) markets to consumers as a "real estate platform" rather than B2B software (broker-licensing posture varies — CA DBO, NY DOS, TX TREC). Currently a software tool, posture holds.

## What this matrix is NOT

- Not a substitute for licensed counsel review (deferred to Phase 2 budget per the constitution).
- Not a launch-blocker list — Phase 0 is a software-tool trickle launch and is geographic-agnostic.
- Not exhaustive of all 50 states — the 7 cells above are the highest-enforcement-risk states for Phase 0 surfaces. The remaining 43 are covered by the federal floor + generic privacy-policy posture.

---

*Beatrice updates this matrix monthly. The "this month" cadence is what Phase 1+ expansion gates against.*
