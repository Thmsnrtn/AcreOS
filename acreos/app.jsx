// acreos/app.jsx — root: theme, tweaks, shell, routing

const { useState: useAState, useEffect: useAEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "homestead",
  "dark": false,
  "sidebarCollapsed": false,
  "showOnboarding": false,
  "founderMode": true,
  "pageState": "normal",
  "showVoice": false,
  "sound": false,
  "day1Mode": false,
  "withoutAcreOS": false,
  "autonomyLevel": 1
}/*EDITMODE-END*/;

function injectCSS(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [page, setPage] = useAState('home');
  const [paletteOpen, setPaletteOpen] = useAState(false);
  const [onbOpen, setOnbOpen] = useAState(!!tweaks.showOnboarding);
  const [drawerOpen, setDrawerOpen] = useAState(false);
  const [closeMoment, setCloseMoment] = useAState(null);
  const [lostFor, setLostFor] = useAState(null);
  const [quickOfferOpen, setQuickOfferOpen] = useAState(false);

  useTheme(tweaks.theme, tweaks.dark);

  // Expose founder mode so Sidebar's NAV filter picks it up
  window.__founderMode = !!tweaks.founderMode;
  window.__r3SoundOn = !!tweaks.sound;

  useAEffect(() => {
    injectCSS('acr-css', ACR_CSS + SHELL_CSS + CC_CSS + PAX_CSS + SET_CSS + ONB_CSS + CP_CSS + TIER1_CSS + TIER2345_CSS + TIER_A_CSS + (window.TIER_B_CSS || '') + (window.TIER_C_CSS || '') + (window.TIER_C_WIRE_CSS || '') + (window.V2_CSS || '') + (window.R3_PRIMITIVES_CSS || '') + (window.R3_FEATURES_CSS || '') + (window.R3_INTEGRATIONS_CSS || '') + (window.R3_DIGEST_CSS || '') + (window.TOUR_CSS || ''));
    // Expose global helpers for any descendant
    window.__acr = window.__acr || {};
    window.__acr.openLost = (deal) => setLostFor(deal || { id: 'D-2417' });
    window.__acr.openClosed = (deal) => setCloseMoment(deal || null);
    window.__acr.openQuickOffer = () => setQuickOfferOpen(true);
    window.__nav = (id) => setPage(id);
  }, []);

  useAEffect(() => { setOnbOpen(!!tweaks.showOnboarding); }, [tweaks.showOnboarding]);
  useAEffect(() => { window.__founderMode = !!tweaks.founderMode; }, [tweaks.founderMode]);

  // Keyboard shortcuts
  useAEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (meta && e.key.toLowerCase() === 'j') { e.preventDefault(); setPage('pax'); }
      if (meta && e.key === ',')              { e.preventDefault(); setPage('settings'); }
      if (meta && e.key.toLowerCase() === 'b'){ e.preventDefault(); setTweak('sidebarCollapsed', !tweaks.sidebarCollapsed); }
      // Founder mode toggle: ⌘⇧F
      if (meta && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setTweak('founderMode', !tweaks.founderMode);
      }
      // Quick offer: ⌘N
      if (meta && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setQuickOfferOpen(true);
      }
      if (e.key === 'Escape') { setDrawerOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tweaks.sidebarCollapsed, tweaks.founderMode]);

  const goAmbient = () => setPage('pax');

  const pageMeta = {
    home:       { title: 'Command Center',        crumbs: ['Today', 'Command Center'] },
    'atlas-run':{ title: 'Atlas analysis',         crumbs: ['Intelligence', 'Atlas', 'Run #4827'] },
    inbox:      { title: 'Inbox',                  crumbs: ['Today', 'Inbox'] },
    calendar:   { title: 'Calendar',               crumbs: ['Today', 'Calendar'] },

    pipeline:   { title: 'Pipeline',               crumbs: ['Deals', 'Pipeline'] },
    parcels:    { title: 'Parcels',                crumbs: ['Deals', 'Parcels'] },
    contacts:   { title: 'Contacts',               crumbs: ['Deals', 'Contacts'] },
    offers:     { title: 'Offers',                 crumbs: ['Deals', 'Offers'] },
    documents:  { title: 'Documents',              crumbs: ['Deals', 'Documents'] },

    buybox:     { title: 'Buy-boxes',              crumbs: ['Acquire', 'Buy-boxes'] },
    lists:      { title: 'Lists',                  crumbs: ['Acquire', 'Lists'] },
    campaigns:  { title: 'Campaigns',              crumbs: ['Acquire', 'Campaigns'] },
    perf:       { title: 'Campaign performance',   crumbs: ['Acquire', 'Performance'] },

    finance:    { title: 'Seller finance',         crumbs: ['Close & Hold', 'Seller finance'] },
    dispos:     { title: 'Dispositions',           crumbs: ['Close & Hold', 'Dispositions'] },

    pax:        { title: 'AcreOS Intelligence',    crumbs: ['Intelligence', 'Ask AcreOS'] },
    agents:     { title: 'Agent workspace',        crumbs: ['Intelligence', 'Agents'] },
    automation: { title: 'Automations',            crumbs: ['Intelligence', 'Automations'] },
    audit:      { title: 'Audit log',              crumbs: ['Intelligence', 'Audit'] },

    team:       { title: 'Team',                   crumbs: ['Platform', 'Team'] },
    billing:    { title: 'Billing',                crumbs: ['Platform', 'Billing'] },
    integrations:{title: 'Integrations',           crumbs: ['Platform', 'Integrations'] },

    settings:   { title: 'Settings',               crumbs: ['Settings', 'Autonomy'] },
    digest:     { title: 'Weekly digest',          crumbs: ['Today', 'Weekly digest'] },

    founder:           { title: 'Founder overview',  crumbs: ['⌁ Founder', 'Overview'] },
    'founder-rev':     { title: 'Revenue',            crumbs: ['⌁ Founder', 'Revenue'] },
    'founder-tenants': { title: 'Tenants',            crumbs: ['⌁ Founder', 'Tenants'] },
    'founder-cost':    { title: 'Agent economics',    crumbs: ['⌁ Founder', 'Agent economics'] },
    'founder-ops':     { title: 'Ops & incidents',    crumbs: ['⌁ Founder', 'Ops'] },
  };
  const meta = pageMeta[page] || { title: page, crumbs: [] };

  const renderPage = () => {
    if (tweaks.day1Mode && page === 'home') {
      return <Day1CommandCenter onExitDay1={() => setTweak('day1Mode', false)} />;
    }
    switch (page) {
      case 'home':         return (window.CommandCenterC ? <CommandCenterC /> : (window.CommandCenterB ? <CommandCenterB /> : <CommandCenter />));
      case 'pax':          return <Pax />;
      case 'settings':     return (window.SettingsC ? <SettingsC tweaks={tweaks} setTweak={setTweak} /> : <Settings tweaks={tweaks} setTweak={setTweak} />);

      case 'pipeline':     return <Pipeline />;
      case 'parcels':      return (window.ParcelDetailB ? <ParcelDetailB /> : <ParcelDetail />);
      case 'contacts':     return <Contacts />;
      case 'inbox':        return (window.InboxC ? <InboxC /> : (window.InboxB ? <InboxB /> : <Inbox />));
      case 'calendar':     return <CalendarPage />;

      case 'buybox':       return <BuyBoxes />;
      case 'lists':        return <Lists />;
      case 'campaigns':    return <Campaigns />;
      case 'perf':         return <CampaignPerf />;

      case 'offers':       return <Offers />;
      case 'documents':    return <Documents />;
      case 'finance':      return <SellerFinance />;
      case 'dispos':       return <Dispositions />;

      case 'agents':       return <AgentWorkspace />;
      case 'automation':   return <Automations />;
      case 'audit':        return <AuditLog />;

      case 'team':         return <Team />;
      case 'billing':      return <Billing />;
      case 'integrations': return <Integrations />;

      case 'founder':          return (window.FounderHomeC ? <FounderHomeC onNav={setPage} /> : (window.FounderHomeB ? <FounderHomeB onNav={setPage} /> : <FounderHome onNav={setPage} />));
      case 'atlas-run':        return (window.AtlasRunC ? <AtlasRunC /> : (window.AtlasRun ? <AtlasRun /> : null));
      case 'founder-rev':      return (window.FounderRevenueC ? <FounderRevenueC /> : <FounderRevenue />);
      case 'digest':           return (window.WeeklyDigestEmail ? <div className="pg"><div className="acr-eyebrow">Weekly digest · email design</div><h1 className="pg-title">Monday morning, 7 AM</h1><p style={{color:'var(--ink-2)',fontSize:13.5,lineHeight:1.6,maxWidth:560,marginBottom:24}}>Plain, scannable, scripture-flavored. Numbers first, then what closed, then what Pax did, then what needs you.</p><WeeklyDigestEmail /></div> : null);
      case 'founder-tenants':  return <FounderTenants />;
      case 'founder-cost':     return <FounderCost />;
      case 'founder-ops':      return <FounderOps />;
      default:
        return (
          <div className="acr-placeholder">
            <div className="acr-eyebrow">Not implemented</div>
            <h2 style={{ font: '600 22px/1.2 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--ink)', margin: '4px 0 6px' }}>{meta.title}</h2>
            <p style={{ color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.6, maxWidth: 520 }}>
              This route isn't wired yet. Every hero surface, all five tier pages, and the founder view are fully mocked — jump via the sidebar or ⌘K.
            </p>
          </div>
        );
    }
  };

  const vp = useViewport();

  return (
    <>
      <SkipToContent />
      <div className="acr-app">
        <Sidebar
          active={page}
          onNavigate={(id) => { setPage(id); setDrawerOpen(false); }}
          collapsed={tweaks.sidebarCollapsed}
          workspace={tweaks.founderMode ? 'AcreOS · Founder' : 'Norton Holdings'}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        {drawerOpen && vp.mobile && (
          <>
            <div className="acr-drawer-scrim" onClick={() => setDrawerOpen(false)} />
            <aside className="acr-drawer">
              <Sidebar
                active={page}
                onNavigate={(id) => { setPage(id); setDrawerOpen(false); }}
                collapsed={false}
                workspace={tweaks.founderMode ? 'AcreOS · Founder' : 'Norton Holdings'}
                onOpenPalette={() => { setPaletteOpen(true); setDrawerOpen(false); }}
              />
            </aside>
          </>
        )}
        <div className="acr-main">
          <TopBar
            title={meta.title}
            crumbs={meta.crumbs}
            dark={tweaks.dark}
            onToggleDark={() => setTweak('dark', !tweaks.dark)}
            onOpenPalette={() => setPaletteOpen(true)}
            onAmbient={goAmbient}
            onOpenDrawer={vp.mobile ? () => setDrawerOpen(true) : null}
          />
          <main id="acr-main-content" className="acr-content" tabIndex={-1} style={{ position: 'relative' }}>
            {window.PageTransition ? <PageTransition pageKey={page + (tweaks.day1Mode ? '-day1' : '')}>
              <div className={cx(tweaks.withoutAcreOS && 'r3-without-fade')}>{renderPage()}</div>
            </PageTransition> : renderPage()}
            {window.StateOverlay && <StateOverlay page={page} />}
            {window.PageStateListener && <PageStateListener />}
            {window.StatesController && <StatesController state={tweaks.pageState} />}
          </main>
        </div>
      </div>

      {vp.mobile && (
        <MobileTabBar
          active={['home','inbox','pipeline'].includes(page) ? page : ''}
          onNavigate={setPage}
          onOpenPalette={() => setPaletteOpen(true)}
          onAmbient={goAmbient}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(id) => setPage(id)}
          onAmbient={goAmbient}
        />
      )}

      {onbOpen && <Onboarding onClose={() => { setOnbOpen(false); setTweak('showOnboarding', false); }} />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Direction" />
        <TweakSelect
          label="Theme"
          value={tweaks.theme}
          options={['homestead', 'quarry', 'nocturne', 'meadow', 'titan']}
          onChange={(v) => setTweak('theme', v)}
        />
        <TweakToggle label="Dark mode" value={tweaks.dark} onChange={(v) => setTweak('dark', v)} />

        <TweakSection label="Shell" />
        <TweakToggle label="Collapsed sidebar" value={tweaks.sidebarCollapsed} onChange={(v) => setTweak('sidebarCollapsed', v)} />
        <TweakToggle label="⌁ Founder mode (⌘⇧F)" value={tweaks.founderMode} onChange={(v) => setTweak('founderMode', v)} />

        <TweakSection label="Jump to" />
        <TweakSelect
          label="Operator"
          value={['home','inbox','calendar','pipeline','parcels','atlas-run','contacts','offers','documents','buybox','lists','campaigns','perf','finance','dispos','pax','agents','automation','audit','team','billing','integrations','settings','digest'].includes(page) ? page : 'home'}
          options={['home','inbox','calendar','pipeline','parcels','atlas-run','contacts','offers','documents','buybox','lists','campaigns','perf','finance','dispos','pax','agents','automation','audit','team','billing','integrations','settings','digest']}
          onChange={setPage}
        />
        {tweaks.founderMode && (
          <TweakSelect
            label="Founder"
            value={page.startsWith('founder') ? page : 'founder'}
            options={['founder','founder-rev','founder-tenants','founder-cost','founder-ops']}
            onChange={setPage}
          />
        )}
        <TweakButton label="Open onboarding" onClick={() => setOnbOpen(true)}>Launch</TweakButton>
        <TweakButton label="Open ⌘K palette" onClick={() => setPaletteOpen(true)}>Launch</TweakButton>
        <TweakButton label="Replay guided tour" onClick={() => { setPage('home'); setTimeout(() => window.__acrLaunchTour && window.__acrLaunchTour(), 400); }}>Start</TweakButton>

        <TweakSection label="Round 3" />
        <TweakToggle label="Sound (ambient ticks · chime)" value={tweaks.sound} onChange={(v) => { setTweak('sound', v); if (v && window.__playSound) window.__playSound('chime'); }} />
        <TweakToggle label="Day-1 empty Command Center" value={tweaks.day1Mode} onChange={(v) => setTweak('day1Mode', v)} />
        <TweakToggle label="Show 'without AcreOS' (faded)" value={tweaks.withoutAcreOS} onChange={(v) => setTweak('withoutAcreOS', v)} />
        <TweakButton label="Trigger 'Deal closed' moment" onClick={() => setCloseMoment({ id: 'D-2196', amount: '$11,500', parcel: '08-441-002', county: 'Coconino, AZ' })}>Show</TweakButton>
        <TweakButton label="Trigger 'Why I lost' capture" onClick={() => setLostFor({ id: 'D-2417' })}>Show</TweakButton>
        <TweakButton label="Quick offer (⌘N)" onClick={() => setQuickOfferOpen(true)}>Open</TweakButton>
        <TweakButton label="Reset first-run tooltips" onClick={() => { Object.keys(localStorage).forEach(k => { if (k.startsWith('acr-fr-')) localStorage.removeItem(k); }); window.toast && window.toast({ label: 'First-run tooltips reset · reload to see.', kind: 'info' }); }}>Reset</TweakButton>

        <TweakSection label="States · C10" />
        <TweakSelect
          label="Page state"
          value={tweaks.pageState}
          options={['normal', 'loading', 'empty', 'error']}
          onChange={(v) => setTweak('pageState', v)}
        />
        <TweakToggle label="Show copy voice card" value={tweaks.showVoice} onChange={(v) => setTweak('showVoice', v)} />
        {tweaks.showVoice && window.CopyVoiceCard && (
          <div style={{ padding: '4px 14px 12px' }}><CopyVoiceCard /></div>
        )}
      </TweaksPanel>

      <style>{`
        .acr-placeholder { padding: 48px 0; max-width: 560px; }
      `}</style>

      {window.ToastHost && <ToastHost />}
      {closeMoment && <DealClosedMoment deal={closeMoment} onDismiss={() => setCloseMoment(null)} />}
      {lostFor && <LostReasonCapture deal={lostFor} onSubmit={() => { setLostFor(null); }} onCancel={() => setLostFor(null)} />}
      {quickOfferOpen && <QuickOffer onClose={() => setQuickOfferOpen(false)} />}
      {window.GuidedTour && <GuidedTour />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
