// acreos/round3-integrations-2.jsx — page wrappers that compose Round 3 features

const { useState: useI2S, useEffect: useI2E } = React;

// ──────────────────────────────────────────────────────────
// COMMAND CENTER C — wrap CommandCenterB with MorningQueue at top
// + first-run tooltip on the autonomous-executor block
// ──────────────────────────────────────────────────────────

const CommandCenterC = () => {
  const Inner = window.CommandCenterB || window.CommandCenter;
  return (
    <div className="cc-c">
      {/* Morning queue lives ABOVE everything else — first thing you see */}
      <MorningQueue />
      {/* Then the existing tier-B Command Center */}
      {Inner && <Inner />}
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// FOUNDER HOME C — wrap FounderHomeB with LiveFeed prominent
// ──────────────────────────────────────────────────────────

const FounderHomeC = ({ onNav }) => {
  const Inner = window.FounderHomeB || window.FounderHome;
  return (
    <div className="founder-c">
      {/* The live feed is THE founder feature; goes right up top after greeting */}
      <div className="founder-c-feed-wrap">
        <LiveFeed />
      </div>
      {Inner && <Inner onNav={onNav} />}
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// FOUNDER REVENUE C — replace cohort table HERO with MRR chart
// (we keep the cohort table below; the chart is the new headline)
// ──────────────────────────────────────────────────────────

const MRR_DATA = [
  { label: 'Apr', v: 11800 },
  { label: 'May', v: 13900 },
  { label: 'Jun', v: 16400 },
  { label: 'Jul', v: 18100 },
  { label: 'Aug', v: 21200 },
  { label: 'Sep', v: 23800 },
  { label: 'Oct', v: 26600 },
  { label: 'Nov', v: 28100 },
  { label: 'Dec', v: 30900 },
  { label: 'Jan', v: 33800 },
  { label: 'Feb', v: 37200 },
  { label: 'Mar', v: 41100 },
  { label: 'Apr', v: 45200 },
];

const FounderRevenueC = () => {
  const totalMRR = MRR_DATA[MRR_DATA.length - 1].v;
  const arr = totalMRR * 12;
  const moM = ((MRR_DATA[MRR_DATA.length - 1].v / MRR_DATA[MRR_DATA.length - 2].v - 1) * 100).toFixed(1);

  return (
    <div className="pg">
      <header className="pg-hd">
        <div>
          <div className="acr-eyebrow" style={{ color: 'var(--brand)' }}>⌁ Revenue</div>
          <h1 className="pg-title">${(totalMRR/1000).toFixed(1)}K MRR · ${(arr/1000).toFixed(0)}K ARR · NRR 118%</h1>
        </div>
        <div className="pg-actions">
          <Button icon="filter">Last 13 mo</Button>
          <Button icon="arrow">Export CSV</Button>
        </div>
      </header>

      <div className="kpi-row">
        {[
          ['Net new MRR', `+$${(MRR_DATA[12].v - MRR_DATA[11].v).toLocaleString()}`, `Mo/mo · ↑ ${moM}%`],
          ['Expansion',   '+$1,840', 'Plan upgrades'],
          ['Churn',       '-$340',   '1 logo · 0.7%'],
          ['LTV : CAC',   '4.7×',    'Trailing 12mo'],
        ].map((k, i) => (
          <Card key={i}>
            <div className="acr-eyebrow">{k[0]}</div>
            <div className="kpi-val">{k[1]}</div>
            <div className="kpi-delta">{k[2]}</div>
          </Card>
        ))}
      </div>

      {/* The chart is the headline — table is now secondary */}
      <SectionTitle eyebrow="MRR · trailing 13 months" title="Where the money is going" action={<Pill tone="pos" dot>+{moM}%</Pill>}>
        <Card padded={false}>
          {window.MRRChart && (
            <MRRChart
              data={MRR_DATA}
              annotations={[
                { index: 4, label: 'Founder Plan launch' },
                { index: 9, label: 'AI v3 ship' },
              ]}
            />
          )}
          <div className="r3-chart-foot">
            <div><div className="acr-eyebrow">Highest mo</div><div className="r3-chart-foot-v acr-tabnum">${(Math.max(...MRR_DATA.map(d=>d.v))/1000).toFixed(1)}K</div></div>
            <div><div className="acr-eyebrow">Mo/mo growth</div><div className="r3-chart-foot-v">+{moM}%</div></div>
            <div><div className="acr-eyebrow">Net retention</div><div className="r3-chart-foot-v">118%</div></div>
            <div><div className="acr-eyebrow">Months profitable</div><div className="r3-chart-foot-v">7</div></div>
          </div>
        </Card>
      </SectionTitle>

      <SectionTitle eyebrow="Plan mix" title="Where the dollars come from">
        <div className="kpi-row">
          {[
            ['Solo · $89/mo',   142, 12638, 67],
            ['Team · $249/mo',   38,  9462, 18],
            ['Pro · $499/mo',    14,  6986,  7],
            ['Enterprise',        4,  4800,  2],
          ].map((p, i) => (
            <Card key={i}>
              <div className="acr-eyebrow">{p[0]}</div>
              <div className="kpi-val">{p[1]}</div>
              <div className="kpi-delta">${p[2].toLocaleString()} · {p[3]}% of revenue</div>
            </Card>
          ))}
        </div>
      </SectionTitle>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// ATLAS RUN C — collapsed-by-default progressive disclosure
// for run-trace, comps, title (the long sections)
// ──────────────────────────────────────────────────────────

const Disclosure = ({ eyebrow, title, defaultOpen = false, summary, children }) => {
  const [open, setOpen] = useI2S(defaultOpen);
  return (
    <div className={cx('r3-disc', open && 'r3-disc-on')}>
      <button className="r3-disc-hd" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <div className="r3-disc-hd-l">
          {eyebrow && <div className="acr-eyebrow">{eyebrow}</div>}
          <h3 className="r3-disc-title">{title}</h3>
          {!open && summary && <div className="r3-disc-summary">{summary}</div>}
        </div>
        <div className="r3-disc-chev">
          <I.chevDn size={14} />
        </div>
      </button>
      {open && <div className="r3-disc-body">{children}</div>}
    </div>
  );
};

const AtlasRunC = () => {
  const Inner = window.AtlasRun;
  if (!Inner) return null;

  // We render Inner (which has the hero), then post-process by injecting
  // disclosure wrappers around its later sections via a wrapper div.
  // For simplicity we keep the existing AtlasRun page and supplement with
  // a "More analysis" disclosure block that replaces what would normally be
  // shown collapsed — but since AtlasRun is monolithic, we add a TOP banner
  // + comp photos block at top and let the page render below.
  const COMPS = [
    { label: 'C1', distance: '2.4 mi', sold: 'Oct 02', $perAc: '1,833', match: 'high' },
    { label: 'C2', distance: '4.7 mi', sold: 'Sep 18', $perAc: '1,817', match: 'high' },
    { label: 'C3', distance: '6.1 mi', sold: 'Aug 30', $perAc: '1,902', match: 'medium' },
    { label: 'C4', distance: '7.8 mi', sold: 'Jul 12', $perAc: '1,821', match: 'medium' },
  ];

  return (
    <div className="atlas-run-c">
      <Inner />
      {/* Comp photos appear after the hero/run-trace; replace the table conceptually */}
      <SectionTitle eyebrow="Comparables · with imagery" title="What 4 nearby parcels actually look like" action={<Button size="sm" variant="ghost">View all 12</Button>}>
        <CompPhotos comps={COMPS} />
      </SectionTitle>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// MOBILE INBOX UPGRADE — Pax draft is primary; voice affordance
// We expose a wrapper that overrides Inbox on mobile only.
// ──────────────────────────────────────────────────────────

const MobileInboxUpgrade = () => {
  const messages = (window.INBOX || []).slice(0, 6);
  const [sel, setSel] = useI2S(messages[0]?.id);
  const [voiceOpen, setVoiceOpen] = useI2S(false);
  const cur = messages.find(m => m.id === sel) || messages[0];
  if (!cur) return null;

  return (
    <div className="r3-mob-inbox">
      <div className="r3-mob-inbox-list">
        {messages.map(m => (
          <button key={m.id} className={cx('r3-mob-item', sel === m.id && 'r3-mob-item-on')} onClick={() => setSel(m.id)}>
            <div className="r3-mob-item-hd">
              <div className="r3-mob-item-from">{m.from}</div>
              <div className="r3-mob-item-time">{m.t || '2h'}</div>
            </div>
            <div className="r3-mob-item-sub">{m.subject || m.preview || 'Re: your offer'}</div>
            {m.paxDraft && (
              <div className="r3-mob-item-tag"><I.wand size={10}/> Pax drafted a reply</div>
            )}
          </button>
        ))}
      </div>

      <div className="r3-mob-inbox-detail">
        <div className="r3-mob-detail-hd">
          <button className="r3-mob-back" onClick={() => setSel(null)}><I.chevLt size={14}/></button>
          <div>
            <div className="r3-mob-detail-from">{cur.from}</div>
            <div className="r3-mob-detail-sub">{cur.subject || 'Re: 9.8ac parcel'}</div>
          </div>
        </div>

        <div className="r3-mob-detail-body">
          <div className="r3-mob-quote">
            "Thanks for the offer. We'd consider $14,500 — that's our floor. Can do paperwork next week if that works."
            <div className="r3-mob-quote-sig">— {cur.from} · 2h ago</div>
          </div>

          {/* Pax draft — primary surface, not a secondary */}
          <div className="r3-mob-pax">
            <div className="r3-mob-pax-hd">
              <Pill tone="brand"><I.wand size={10}/> Pax draft</Pill>
              <span className="muted">High confidence · meets in middle</span>
            </div>
            <p className="r3-mob-pax-body">
              Thanks for the counter, <b>{cur.from?.split(' ')[0] || 'Carol'}</b>. We can meet at <b>$13,800</b> with 24-month seller-finance at 12% APR, $500/mo. I'll send paperwork today if that works.
            </p>
            <div className="r3-mob-pax-actions">
              <Button variant="ghost" size="sm" icon="x">Skip</Button>
              <Button variant="subtle" size="sm" icon="pen">Edit</Button>
              <Button variant="primary" size="sm" iconRight="arrow" onClick={() => {
                window.toast && window.toast({
                  label: `Reply sent to ${cur.from}.`,
                  kind: 'success',
                  onUndo: () => window.toast({ label: 'Reply pulled back.' }),
                });
                if (window.__playSound) window.__playSound('chime');
              }}>Send</Button>
            </div>
          </div>

          {/* Voice affordance — fixed bottom */}
          <button className="r3-mob-voice" onClick={() => setVoiceOpen(true)}>
            <span className="r3-mob-voice-pulse" />
            <I.bolt size={14} />
            Hold to dictate a reply
          </button>
        </div>

        {voiceOpen && (
          <div className="r3-mob-voice-modal" onClick={() => setVoiceOpen(false)}>
            <div className="r3-mob-voice-card" onClick={e => e.stopPropagation()}>
              <div className="r3-mob-voice-wave">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} style={{ animationDelay: `${i * 60}ms`, height: `${20 + Math.abs(Math.sin(i)) * 30}px` }}/>
                ))}
              </div>
              <div className="r3-mob-voice-text">"Tell Carol we'll do thirteen-eight, twenty-four month note, send paperwork today"</div>
              <div className="r3-mob-voice-actions">
                <Button variant="ghost" size="sm" onClick={() => setVoiceOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" iconRight="arrow" onClick={() => { setVoiceOpen(false); window.toast && window.toast({ label: 'Pax drafted from your voice note.', kind: 'success' }); }}>Use as draft</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Wrap Inbox: on mobile, show the upgrade; on desktop, render InboxB
const InboxC = () => {
  const [isMobile, setIsMobile] = useI2S(typeof window !== 'undefined' && window.innerWidth < 760);
  useI2E(() => {
    const onR = () => setIsMobile(window.innerWidth < 760);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const Inner = window.InboxB || window.Inbox;
  if (isMobile) return <MobileInboxUpgrade />;
  return Inner ? <Inner /> : null;
};

Object.assign(window, {
  CommandCenterC, FounderHomeC, FounderRevenueC, AtlasRunC,
  MobileInboxUpgrade, InboxC, Disclosure, MRR_DATA,
});
