/**
 * JSON-LD payload builders for AcreOS public pages.
 *
 * Each helper returns a Schema.org-shaped object suitable for passing
 * directly to <JsonLd data={...} />. Keep these centralised so we don't
 * scatter `@context` strings across page files — and so the social /
 * search teams can audit one source of truth.
 *
 * References:
 * - https://schema.org/Organization
 * - https://schema.org/WebSite
 * - https://schema.org/Product
 * - https://schema.org/Offer
 * - https://schema.org/BlogPosting
 * - https://schema.org/DefinedTerm
 */

import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";

const SITE_URL = "https://acreos.io";
const ORG_NAME = "AcreOS";
const ORG_DESCRIPTION =
  "AcreOS is the operating system for Land Investors — find motivated sellers, analyze parcels, send direct mail, close deals, and manage seller-financed notes.";

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ORG_NAME,
    url: SITE_URL,
    description: ORG_DESCRIPTION,
    logo: `${SITE_URL}/favicon.png`,
    sameAs: [],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: `${SITE_URL}/security`,
      areaServed: "US",
      availableLanguage: ["English"],
    },
  } as const;
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: ORG_NAME,
    url: SITE_URL,
    publisher: { "@type": "Organization", name: ORG_NAME, url: SITE_URL },
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  } as const;
}

export function productLandingSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "AcreOS",
    description: ORG_DESCRIPTION,
    brand: { "@type": "Brand", name: "AcreOS" },
    url: SITE_URL,
    image: `${SITE_URL}/images/aerial_view_wide_hor_0f1000c4.jpg`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: (TIER_PRICES_CENTS.solo.priceMonthlyCents / 100).toFixed(2),
      highPrice: (TIER_PRICES_CENTS.empire.priceMonthlyCents / 100).toFixed(2),
      offerCount: 4,
      url: `${SITE_URL}/pricing`,
    },
  } as const;
}

const TIER_DESCRIPTIONS: Record<Tier, { name: string; description: string }> = {
  solo: { name: "Starter", description: "Replace your spreadsheet." },
  operator: { name: "Pro", description: "For serious operators." },
  empire: { name: "Scale", description: "For growing teams." },
};

export function pricingProductSchema() {
  const offers = (Object.keys(TIER_PRICES_CENTS) as Tier[]).map((tier) => {
    const tierPricing = TIER_PRICES_CENTS[tier];
    const tierMeta = TIER_DESCRIPTIONS[tier];
    return {
      "@type": "Offer",
      name: tierMeta.name,
      description: tierMeta.description,
      price: (tierPricing.priceMonthlyCents / 100).toFixed(2),
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (tierPricing.priceMonthlyCents / 100).toFixed(2),
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    };
  });

  // Free tier prepended explicitly — useful signal for crawler.
  offers.unshift({
    "@type": "Offer",
    name: "Free",
    description: "Explore the platform.",
    price: "0.00",
    priceCurrency: "USD",
    url: `${SITE_URL}/pricing`,
    availability: "https://schema.org/InStock",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "0.00",
      priceCurrency: "USD",
      unitText: "MONTH",
    },
  });

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "AcreOS",
    description: ORG_DESCRIPTION,
    brand: { "@type": "Brand", name: "AcreOS" },
    url: `${SITE_URL}/pricing`,
    offers,
  } as const;
}

export function securityPageSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Security at AcreOS",
    description:
      "How AcreOS protects Land Investor data — encryption, access controls, audit logging, and incident response.",
    url: `${SITE_URL}/security`,
    isPartOf: { "@type": "WebSite", name: ORG_NAME, url: SITE_URL },
    mainEntity: {
      "@type": "Organization",
      name: ORG_NAME,
      url: SITE_URL,
      mainEntityOfPage: {
        "@type": "CreativeWork",
        name: "AcreOS Security Practices",
        url: `${SITE_URL}/security`,
      },
    },
  } as const;
}

export interface BlogPostingInput {
  title: string;
  description: string;
  datePublished: string; // ISO date
  url: string;
}

export function blogPostingSchema(entry: BlogPostingInput) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: entry.title,
    description: entry.description,
    datePublished: entry.datePublished,
    dateModified: entry.datePublished,
    url: entry.url,
    author: { "@type": "Organization", name: ORG_NAME, url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: ORG_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": entry.url },
  } as const;
}

export interface DefinedTermInput {
  slug: string;
  term: string;
  definition: string;
}

export function glossarySchema(terms: DefinedTermInput[]) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: "AcreOS Land Investor Glossary",
    description:
      "Plain-English definitions for the vocabulary land investors encounter — yellow letter, skip trace, AVM, executory contract, and more.",
    url: `${SITE_URL}/glossary`,
    hasDefinedTerm: terms.map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${SITE_URL}/glossary#${t.slug}`,
      name: t.term,
      description: t.definition,
      inDefinedTermSet: `${SITE_URL}/glossary`,
    })),
  } as const;
}

export const SITE = { url: SITE_URL, name: ORG_NAME, description: ORG_DESCRIPTION };
