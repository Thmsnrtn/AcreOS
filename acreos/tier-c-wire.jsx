// acreos/tier-c-wire.jsx — C9 + C10 wiring across all pages
// Adds loading skeletons, empty states, and error affordances by intercepting
// page renders. Also demonstrates copy voice through a "States" tweak overlay.

const { useState: useCWS, useEffect: useCWE } = React;

// ──────────────────────────────────────────────────────────
// C9/C10 · State Inspector
// A floating control (shown when tweaks.showStates is on) that lets you
// demo Loading / Empty / Error states for the current page, so we can
// show off C9 copy and C10 state work without faking real data gaps.
// ──────────────────────────────────────────────────────────

const StateOverlay = ({ page }) => {
  const mode = window.__pageState || 'normal';
  if (mode === 'normal') return null;

  // Per-page empty/loading/error contents
  const CONTENT = {
    pipeline: {
      empty: {
        icon: 'pipeline',
        eyebrow: 'No deals yet',
        title: "Your pipeline is empty. That's a choice you haven't made yet.",
        body: 'Launch a campaign or import a list. Your first deals will appear here within the hour once Atlas scores them.',
        actions: [
          { label: 'Build a buy-box', icon: 'plus', variant: 'subtle' },
          { label: 'Launch a campaign', icon: 'bolt' },
        ],
      },
    },
    contacts: {
      empty: {
        icon: 'users',
        eyebrow: 'No contacts yet',
        title: "No owners in your book. Mail is how this starts.",
        body: 'Contacts land here automatically when recipients respond, get skip-traced, or come from a list. Send your first campaign to seed this.',
        actions: [{ label: 'Import list', icon: 'folder', variant: 'subtle' }, { label: 'New campaign', icon: 'bolt' }],
      },
    },
    inbox: {
      empty: {
        icon: 'inbox',
        eyebrow: 'All clear',
        title: 'Inbox is empty. Nothing needs a reply.',
        body: 'Email, SMS, and mail-scan replies land here together. Pax drafts a response for each one before you open it.',
        actions: [{ label: 'Compose', icon: 'plus' }],
      },
    },
    campaigns: {
      empty: {
        icon: 'mail',
        eyebrow: 'No campaigns yet',
        title: "You haven't sent mail yet.",
        body: 'Campaigns match a buy-box against owners and send yellow letters, postcards, or texts. First replies land 4–7 days after your first send.',
        actions: [{ label: 'Launch a campaign', icon: 'bolt' }],
      },
    },
    documents: {
      empty: {
        icon: 'folder',
        eyebrow: 'Vault is empty',
        title: 'No documents stored. Close a deal to populate.',
        body: 'Purchase agreements, title work, and notes are filed here automatically when Sophie generates them. Nothing here means nothing has closed yet.',
        actions: [{ label: 'Upload document', icon: 'plus' }],
      },
    },
    agents: {
      empty: {
        icon: 'bolt',
        eyebrow: 'No active runs',
        title: 'Agents are idle. No work in flight.',
        body: 'Atlas, Pax, and Sophie run continuously when there are deals to evaluate, replies to draft, or notes to service. The executor checks every 10 minutes.',
        actions: [{ label: 'See schedule', icon: 'clock', variant: 'subtle' }, { label: 'Run now', icon: 'play' }],
      },
    },
    offers: {
      empty: {
        icon: 'coin',
        eyebrow: 'No offers drafted',
        title: 'No offers in flight.',
        body: 'Open a parcel and draft an offer, or let Atlas generate one from the pipeline. Offers stay here until they\'re sent, accepted, or withdrawn.',
        actions: [{ label: 'Draft offer', icon: 'plus' }],
      },
    },
    lists: {
      empty: {
        icon: 'layers',
        eyebrow: 'No lists built',
        title: 'You have no saved lists yet.',
        body: 'A list is a buy-box applied to a region. Build one from county + acreage + absentee criteria — Atlas scores every match.',
        actions: [{ label: 'New list', icon: 'plus' }],
      },
    },
  };

  const data = CONTENT[page] || {
    empty: {
      icon: 'dot', title: 'Nothing here yet.',
      body: 'This surface populates as you use AcreOS.',
    },
  };

  if (mode === 'loading') {
    return (
      <div className="state-overlay">
        <div className="state-overlay-hd">
          <div className="acr-eyebrow">Loading</div>
          <div className="state-overlay-title">Pulling fresh data…</div>
        </div>
        <div className="state-overlay-body">
          <Card padded={false}>
            <SkeletonRow cols={5} />
            <SkeletonRow cols={5} />
            <SkeletonRow cols={5} />
            <SkeletonRow cols={5} />
            <SkeletonRow cols={5} />
          </Card>
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div className="state-overlay">
        <div className="state-overlay-hd">
          <div className="acr-eyebrow" style={{ color: 'var(--neg)' }}>Couldn't load</div>
          <div className="state-overlay-title">Something broke. Not your fault.</div>
        </div>
        <div className="state-overlay-body">
          <ErrorBanner
            title="DataTree timed out after 12 seconds."
            detail="Parcel and comp data couldn't refresh. Your last cached copy is still visible underneath — it's 14 minutes old."
            onRetry={() => { window.__pageState = 'normal'; window.dispatchEvent(new Event('acr-state')); }}
            onDismiss={() => { window.__pageState = 'normal'; window.dispatchEvent(new Event('acr-state')); }}
          />
          <div style={{ height: 12 }} />
          <EmptyState
            icon="bell"
            title="Retry, or keep going with cached data."
            body="If this keeps happening, check the DataTree integration in Settings → Integrations. Most outages clear in under 5 minutes."
            actions={[
              { label: 'Use cached', variant: 'subtle' },
              { label: 'Retry now', icon: 'arrow' },
            ]}
          />
        </div>
      </div>
    );
  }

  if (mode === 'empty') {
    return (
      <div className="state-overlay state-overlay-empty">
        <EmptyState {...data.empty} />
      </div>
    );
  }

  return null;
};

// Drive `__pageState` from Tweaks → showStates flag
const StatesController = ({ state, onChange }) => {
  useCWE(() => {
    window.__pageState = state;
    window.dispatchEvent(new Event('acr-state'));
  }, [state]);
  return null;
};

const PageStateListener = () => {
  const [, force] = useCWS(0);
  useCWE(() => {
    const on = () => force(x => x + 1);
    window.addEventListener('acr-state', on);
    return () => window.removeEventListener('acr-state', on);
  }, []);
  return null;
};

// ──────────────────────────────────────────────────────────
// Copy voice examples — shown in Tweaks when "Copy voice" is on
// ──────────────────────────────────────────────────────────

const CopyVoiceCard = () => (
  <Card className="voice-card">
    <div className="acr-eyebrow">Copy system · operator voice</div>
    <div className="voice-title">Verbs first. Numbers before adjectives. Trust earned in specifics.</div>
    <div className="voice-examples">
      <div className="voice-row">
        <div className="voice-bad"><span className="voice-tag voice-tag-bad">Before</span>Welcome back! Here's what's happening today.</div>
        <div className="voice-good"><span className="voice-tag voice-tag-good">After</span><b>Good afternoon, Thomas.</b> 3 deals need you today.</div>
      </div>
      <div className="voice-row">
        <div className="voice-bad"><span className="voice-tag voice-tag-bad">Before</span>I've prepared a draft for you to review when ready.</div>
        <div className="voice-good"><span className="voice-tag voice-tag-good">After</span>Pax drafted a reply. Review before send.</div>
      </div>
      <div className="voice-row">
        <div className="voice-bad"><span className="voice-tag voice-tag-bad">Before</span>Based on our analysis, you might want to consider this offer.</div>
        <div className="voice-good"><span className="voice-tag voice-tag-good">After</span>Offer $11,500. Comp median $1,830/ac. 63% is standard here.</div>
      </div>
      <div className="voice-row">
        <div className="voice-bad"><span className="voice-tag voice-tag-bad">Before</span>No items to display at this time.</div>
        <div className="voice-good"><span className="voice-tag voice-tag-good">After</span>Pipeline is empty. That's a choice you haven't made yet.</div>
      </div>
    </div>
  </Card>
);

// ──────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────
const TIER_C_WIRE_CSS = `
  .state-overlay {
    position: absolute; inset: 0;
    background: var(--bg); z-index: 40;
    padding: 24px 32px;
    overflow: auto;
    display: flex; flex-direction: column; gap: 20px;
  }
  .state-overlay-empty {
    display: flex; align-items: center; justify-content: center;
    padding: 80px 32px;
  }
  .state-overlay-hd .state-overlay-title {
    font: 600 22px/1.2 var(--font-display); letter-spacing: -0.02em;
    color: var(--ink); margin-top: 4px;
  }
  .state-overlay-body { flex: 1; display: flex; flex-direction: column; gap: 12px; }

  .voice-card { background: linear-gradient(180deg, var(--surface-2), var(--surface)); }
  .voice-title {
    font: 600 15px/1.4 var(--font-display); letter-spacing: -0.01em;
    color: var(--ink); margin: 6px 0 14px; text-wrap: pretty;
  }
  .voice-examples { display: flex; flex-direction: column; gap: 10px; }
  .voice-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    border-top: 0.5px solid var(--line-soft); padding-top: 10px;
  }
  .voice-row:first-child { border-top: 0; padding-top: 0; }
  .voice-bad, .voice-good {
    padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.5;
    position: relative; text-wrap: pretty;
  }
  .voice-bad  { background: color-mix(in srgb, var(--neg) 6%, var(--surface)); color: var(--ink-3); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--neg) 40%, transparent); }
  .voice-good { background: color-mix(in srgb, var(--pos) 6%, var(--surface)); color: var(--ink); }
  .voice-good b { font-weight: 600; }
  .voice-tag {
    display: block; font: 500 10px/1 var(--font-sans); letter-spacing: 0.06em;
    text-transform: uppercase; margin-bottom: 4px;
  }
  .voice-tag-bad { color: var(--neg); }
  .voice-tag-good { color: var(--pos); }
  @media (max-width: 767px) { .voice-row { grid-template-columns: 1fr; } }
`;

Object.assign(window, {
  StateOverlay, StatesController, PageStateListener, CopyVoiceCard,
  TIER_C_WIRE_CSS,
});
