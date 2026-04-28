// Variant inventory data — mirrors docs/exhaustive-completion/variant-inventory.md
// REMOVE_BEFORE_LAUNCH (Gap 1.1.G).

export type CategoryId = 'visual-review' | 'platform-tweak' | 'build-defer';

export interface Decision {
  id: string;
  category: CategoryId;
  title: string;
  surface?: string; // production path for Category 1 + 3
  prototypeRef?: string; // file ref for Category 1
  tier?: number; // grouping for Category 1
  description?: string;
  options?: { id: string; label: string; description?: string }[];
  defaultValue?: string;
}

export const DECISIONS: Decision[] = [
  // Category 1 — Per-surface visual review (28)
  ...[
    { slug: 'home', surface: '/today', tier: 1, ref: 'acreos/command-center.jsx (CommandCenter)' },
    { slug: 'pipeline', surface: '/pipeline', tier: 1, ref: 'acreos/pages-tier1.jsx (Pipeline)' },
    { slug: 'parcels', surface: '/parcels/81', tier: 1, ref: 'acreos/pages-tier1.jsx (Parcels detail)' },
    { slug: 'inbox', surface: '/inbox', tier: 1, ref: 'acreos/pages-tier1.jsx (Inbox)' },
    { slug: 'contacts', surface: '/contacts', tier: 1, ref: 'acreos/pages-tier1.jsx (Contacts)' },
    { slug: 'calendar', surface: '/calendar', tier: 1, ref: 'acreos/pages-tier1.jsx (Calendar)' },
    { slug: 'buybox', surface: '/buyboxes', tier: 2, ref: 'acreos/pages-tier2345.jsx (Buybox)' },
    { slug: 'lists', surface: '/lists', tier: 2, ref: 'acreos/pages-tier2345.jsx (Lists)' },
    { slug: 'campaigns', surface: '/campaigns', tier: 2, ref: 'acreos/pages-tier2345.jsx (Campaigns)' },
    { slug: 'perf', surface: '/campaigns/performance', tier: 2, ref: 'acreos/pages-tier2345.jsx (Performance)' },
    { slug: 'offers', surface: '/offers', tier: 3, ref: 'acreos/pages-tier2345.jsx (Offers)' },
    { slug: 'documents', surface: '/documents', tier: 3, ref: 'acreos/pages-tier2345.jsx (Documents)' },
    { slug: 'finance', surface: '/finance', tier: 3, ref: 'acreos/pages-tier2345.jsx (Finance)' },
    { slug: 'dispos', surface: '/dispositions', tier: 3, ref: 'acreos/pages-tier2345.jsx (Dispositions)' },
    { slug: 'agents', surface: '/agents', tier: 4, ref: 'acreos/pages-tier2345.jsx (Agents)' },
    { slug: 'automation', surface: '/automations', tier: 4, ref: 'acreos/pages-tier2345.jsx (Automations)' },
    { slug: 'audit', surface: '/audit', tier: 4, ref: 'acreos/pages-tier2345.jsx (Audit)' },
    { slug: 'settings', surface: '/settings', tier: 4, ref: 'acreos/settings.jsx' },
    { slug: 'team', surface: '/team', tier: 4, ref: 'acreos/pages-tier2345.jsx (Team)' },
    { slug: 'billing', surface: '/billing', tier: 4, ref: 'acreos/pages-tier2345.jsx (Billing)' },
    { slug: 'integrations', surface: '/integrations', tier: 4, ref: 'acreos/round3-integrations.jsx' },
    { slug: 'pax', surface: '/ai', tier: 4, ref: 'acreos/pax.jsx' },
    { slug: 'founder', surface: '/founder', tier: 5, ref: '(founder home — no direct prototype)' },
    { slug: 'atlas-run', surface: '/founder/atlas-run', tier: 5, ref: '(founder mode)' },
    { slug: 'founder-rev', surface: '/founder/revenue', tier: 5, ref: '(founder mode — route unimplemented)' },
    { slug: 'founder-tenants', surface: '/founder/tenants', tier: 5, ref: '(founder mode — route unimplemented)' },
    { slug: 'founder-cost', surface: '/founder/cost', tier: 5, ref: '(founder mode — route unimplemented)' },
    { slug: 'founder-ops', surface: '/founder/ops', tier: 5, ref: '(founder mode — route unimplemented)' },
  ].map<Decision>((s) => ({
    id: `vr-${s.slug}`,
    category: 'visual-review',
    title: s.surface,
    surface: s.surface,
    prototypeRef: s.ref,
    tier: s.tier,
    options: [
      { id: 'accept', label: 'Accept', description: 'Fidelity matches prototype well enough' },
      { id: 'fix-needed', label: 'Fix needed', description: 'Note specific gaps for 1.1.C-followup' },
      { id: 'rebuild', label: 'Rebuild', description: 'Production diverged too far — full re-implementation' },
    ],
  })),

  // Category 2 — Global platform tweaks
  {
    id: 'platform-density',
    category: 'platform-tweak',
    title: 'Platform density',
    description: 'Compact / regular / comfy — affects all surfaces via --acr-density-* CSS vars',
    options: [
      { id: 'compact', label: 'Compact', description: 'Tighter spacing, more content per viewport' },
      { id: 'regular', label: 'Regular', description: 'Default — balanced' },
      { id: 'comfy', label: 'Comfy', description: 'More breathing room' },
    ],
    defaultValue: 'regular',
  },
  {
    id: 'platform-primary-color',
    category: 'platform-tweak',
    title: 'Platform primary color',
    description: 'Brand accent — constrained to design-system tokens',
    options: [
      { id: 'brand-default', label: 'Default — terracotta', description: '#D97757 (current)' },
      { id: 'brand-deeper', label: 'Deeper terracotta', description: 'More grounded' },
      { id: 'brand-warmer', label: 'Warmer terracotta', description: 'Softer feel' },
    ],
    defaultValue: 'brand-default',
  },
  {
    id: 'platform-font-size-base',
    category: 'platform-tweak',
    title: 'Base font size',
    description: 'Affects readability across all surfaces',
    options: [
      { id: '14', label: '14px' },
      { id: '15', label: '15px' },
      { id: '16', label: '16px (default)' },
    ],
    defaultValue: '16',
  },
  {
    id: 'platform-dark-default',
    category: 'platform-tweak',
    title: 'Dark mode default',
    description: 'Whether dark mode is opt-in or default',
    options: [
      { id: 'opt-in', label: 'Opt-in (default)' },
      { id: 'default-on', label: 'Dark by default' },
    ],
    defaultValue: 'opt-in',
  },

  // Category 3 — Build vs defer
  ...['founder-revenue-route', 'founder-cost-route', 'founder-ops-route', 'founder-tenants-route'].map<Decision>((id) => ({
    id,
    category: 'build-defer',
    title: `/${id.replace(/-route$/, '').replace(/-/g, '/')}`,
    description: 'Prototype shows this surface but production route is not registered in App.tsx',
    surface: `/${id.replace(/-route$/, '').replace(/-/g, '/')}`,
    options: [
      { id: 'build-now', label: 'Build now', description: 'Register route + implement page in 1.1.F' },
      { id: 'defer', label: 'Defer to post-launch', description: 'Mark upcoming, not in current scope' },
      { id: 'drop', label: 'Drop entirely', description: 'Remove prototype reference; close decision' },
    ],
  })),
];

export const CATEGORIES: { id: CategoryId; title: string; description: string }[] = [
  {
    id: 'visual-review',
    title: 'Visual review',
    description: 'Per-surface fidelity vs prototype (28 surfaces)',
  },
  {
    id: 'platform-tweak',
    title: 'Platform tweaks',
    description: 'Global density / color / typography / theme defaults',
  },
  {
    id: 'build-defer',
    title: 'Build vs defer',
    description: 'Unimplemented founder sub-routes — build now, defer, or drop',
  },
];
