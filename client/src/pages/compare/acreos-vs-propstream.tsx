/**
 * /compare/acreos-vs-propstream — SEO lander targeting "propstream
 * alternative" search intent. See ComparisonPage.tsx for scaffold notes
 * and the noindex guard that stays on until founder writes positioning.
 */

import { ComparisonPage, type ComparisonConfig } from "./ComparisonPage";

const CONFIG: ComparisonConfig = {
  slug: "acreos-vs-propstream",
  competitor: "PropStream",
  h1: "AcreOS vs PropStream",
  metaDescription:
    "Comparing AcreOS and PropStream for land investors — CRM, comps, direct mail, automated due diligence, and seller-financed note servicing in one platform.",
  // Capability matrix — null means founder hasn't confirmed yet. Filled
  // capabilities are the ones we can ship with confidence from our own
  // feature set; the competitor column stays null until Tom verifies.
  matrix: [
    { capability: "Parcel search + skip trace", acreos: true, competitor: null },
    { capability: "Built-in direct mail (yellow letters)", acreos: true, competitor: null },
    { capability: "AI-drafted seller replies", acreos: true, competitor: null },
    { capability: "Seller-financed note servicing", acreos: true, competitor: null },
    { capability: "Automated due diligence (county records)", acreos: true, competitor: null },
    { capability: "Pipeline + deal close workflow", acreos: true, competitor: null },
    {
      capability: "Free tier",
      acreos: true,
      competitor: null,
      note: "AcreOS ships a free tier with the core list-pull + CRM loop.",
    },
  ],
};

export default function AcreosVsPropstreamPage() {
  return <ComparisonPage config={CONFIG} />;
}
