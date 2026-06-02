/**
 * /tools/calculator/embed — iframe-friendly Land Deal Calculator.
 *
 * No AcreOS chrome, no marketing CTA card, no mobile sticky bar — just
 * the calculator + a small "Powered by AcreOS" link at the bottom. This
 * route is the only one with the X-Frame-Options override (see
 * server/middleware/security.ts) so the main app remains protected
 * against clickjacking.
 */
import { usePageMeta } from "@/hooks/use-document-title";
import { LandDealCalculator } from "@/components/tools/LandDealCalculator";

export default function CalculatorEmbedPage() {
  usePageMeta(
    "Land Deal Calculator (embed)",
    "Free embeddable land flip calculator from AcreOS.",
  );

  return (
    <main className="min-h-screen bg-background">
      <LandDealCalculator embed />
    </main>
  );
}
