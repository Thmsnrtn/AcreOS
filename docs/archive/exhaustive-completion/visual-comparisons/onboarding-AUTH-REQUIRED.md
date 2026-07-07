# Onboarding wizard — Multi-step Auth-Required Reference

**Production URL:** https://acreos.io/onboarding (auto-fires on first sign-in if `organizations.onboardingCompleted` is false)

Wizard has 5 production steps (per `client/src/components/onboarding/OnboardingWizard.tsx`); the prototype has 9 steps. Production preserves business-type intelligence (14 types).

## Prototype step screenshots (9 steps × 2 viewports = 18)

- welcome: `docs/exhaustive-completion/prototype-screenshots/onboarding-welcome-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-welcome-375.png`
- markets: `docs/exhaustive-completion/prototype-screenshots/onboarding-markets-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-markets-375.png`
- buybox: `docs/exhaustive-completion/prototype-screenshots/onboarding-buybox-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-buybox-375.png`
- goals: `docs/exhaustive-completion/prototype-screenshots/onboarding-goals-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-goals-375.png`
- autonomy: `docs/exhaustive-completion/prototype-screenshots/onboarding-autonomy-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-autonomy-375.png`
- connections: `docs/exhaustive-completion/prototype-screenshots/onboarding-connections-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-connections-375.png`
- phone: `docs/exhaustive-completion/prototype-screenshots/onboarding-phone-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-phone-375.png`
- billing: `docs/exhaustive-completion/prototype-screenshots/onboarding-billing-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-billing-375.png`
- reveal: `docs/exhaustive-completion/prototype-screenshots/onboarding-reveal-1440.png` / `docs/exhaustive-completion/prototype-screenshots/onboarding-reveal-375.png`

## Founder must:

1. Sign out + create a fresh test account, OR have a fresh-org workspace
2. Trigger the wizard
3. Walk all 5 production steps on desktop + mobile
4. Compare each to the corresponding prototype step (note: production has fewer steps)
5. Save each step screenshot → `docs/exhaustive-completion/founder-screenshots/desktop/onboarding-step-N.png`

## Final Classification

[x] AUTH-REQUIRED
