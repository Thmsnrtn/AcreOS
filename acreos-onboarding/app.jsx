// acreos-onboarding/app.jsx — wizard shell

const { useState: useStateApp, useEffect: useEffectApp } = React;

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'markets', label: 'Markets' },
  { id: 'buybox', label: 'Buy-box' },
  { id: 'goals', label: 'Goals' },
  { id: 'autonomy', label: 'Autonomy' },
  { id: 'connections', label: 'Connect' },
  { id: 'phone', label: 'Phone' },
  { id: 'billing', label: 'Billing' },
  { id: 'reveal', label: 'Done' },
];

function App() {
  const [step, setStep] = useStateApp(0);
  const [data, setData] = useStateApp({
    counties: ['apache-az', 'coconino-az'],
    dealType: ['flip'],
    acresMin: 1,
    acresMax: 40,
    priceMin: '$3,000',
    priceMax: '$45,000',
    access: ['paved', 'gravel'],
    utils: ['no-utils'],
    experience: 'growing',
    dealsTarget: 4,
    northStar: '',
    countryCode: '+1',
    phone: '',
    paxNumber: 0,
    plan: 'operator',
    deferBilling: false,
    autonomy: 'execute',
    guardrail: 5000,
    connections: { regrid: true, batch: true, lob: false, stripe: false, twilio: false },
    startTour: true,
  });

  const set = (key, val) => setData(d => ({ ...d, [key]: val }));

  // Tweaks
  const [tweaks, setTweak] = window.useTweaks(window.OB_TWEAK_DEFAULTS);
  const { TweaksPanel, TweakSection, TweakToggle, TweakRadio } = window;

  const { ScreenWelcome, ScreenMarkets } = window.OBScreens1;
  const { ScreenBuyBox, ScreenGoals } = window.OBScreens2;
  const { ScreenPhone, ScreenBilling, ScreenReveal } = window.OBScreens3;
  const { ScreenAutonomy, ScreenConnections } = window.OBScreens4;

  // keyboard nav
  useEffectApp(() => {
    const onKey = (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'Enter' && step < STEPS.length - 1 && canAdvance()) next();
      if (e.key === 'Escape' && step > 0) back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const canAdvance = () => {
    if (step === 1) return (data.counties || []).length > 0;
    if (step === 2) return (data.dealType || []).length > 0;
    if (step === 3) return !!data.experience;
    if (step === 4) return !!data.autonomy;
    if (step === 5) {
      const c = data.connections || {};
      return c.regrid && c.batch; // Lob can be added pre-mail
    }
    if (step === 6) return data.deferBilling || (data.phone && data.phone.length >= 7);
    return true;
  };

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));
  const finish = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'onboarding-complete', data }, '*');
    }
    // Persist tour intent for the main app to detect
    try {
      localStorage.setItem('acreos-onboarding-data', JSON.stringify(data));
      if (data.startTour) localStorage.setItem('acreos-tour-pending', '1');
    } catch (e) {}
    window.location.href = data.startTour ? 'acreos.html?tour=1' : 'acreos.html';
  };

  const renderScreen = () => {
    const props = { data, set, tweaks };
    switch (step) {
      case 0: return <ScreenWelcome {...props} next={next} />;
      case 1: return <ScreenMarkets {...props} />;
      case 2: return <ScreenBuyBox {...props} />;
      case 3: return <ScreenGoals {...props} />;
      case 4: return <ScreenAutonomy {...props} />;
      case 5: return <ScreenConnections {...props} />;
      case 6: return <ScreenPhone {...props} />;
      case 7: return <ScreenBilling {...props} />;
      case 8: return <ScreenReveal data={data} finish={finish} />;
      default: return null;
    }
  };

  const isWide = step === 1 || step === 2 || step === 4 || step === 5 || step === 7;

  return (
    <div className="ob">
      <header className="ob-header">
        <div className="ob-logo">
          <span className="ob-logo-mark">A</span>
          AcreOS
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {step > 0 && (
            <span className="ob-help-tip" title="Use the Tweaks panel to control how much explanation you see">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-1 1-2 1.5-2 2.5"/>
                <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
              </svg>
              Need more detail? Toggle <b style={{marginLeft:2,color:'var(--ink)'}}>Tweaks</b>
            </span>
          )}
          <a href="#" className="ob-help">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-1 1-2 1.5-2 2.5"/>
              <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
            </svg>
            Need a hand?
          </a>
        </div>
      </header>

      <div className="ob-progress" style={{ marginBottom: 12 }}>
        {STEPS.slice(1).map((s, i) => (
          <div
            key={s.id}
            className={`ob-progress-step ${i + 1 === step ? 'is-active' : i + 1 < step ? 'is-done' : ''}`}
          >
            {i + 1 === step && <span className="ob-step-label">{s.label}</span>}
          </div>
        ))}
      </div>

      <main className="ob-stage" key={step}>
        {renderScreen()}
      </main>

      {step < STEPS.length - 1 && (
        <footer className="ob-footer">
          <div className={`ob-actions ${isWide ? 'ob-actions-wide' : ''}`}>
            {step > 0 ? (
              <button className="ob-btn ob-btn-ghost ob-btn-arrow-back" onClick={back}>
                Back
              </button>
            ) : <span />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="ob-meta">
                {step === 0 ? 'Press Enter to start' : `Step ${step} of ${STEPS.length - 2}`}
              </span>
              <button
                className="ob-btn ob-btn-primary ob-btn-arrow"
                onClick={next}
                disabled={!canAdvance()}
              >
                {step === 0 ? 'Get started' : step === STEPS.length - 2 ? 'Finish setup' : 'Continue'}
              </button>
            </div>
          </div>
        </footer>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Clarity" subtitle="How much hand-holding the wizard shows.">
          <TweakRadio
            label="Explanation density"
            value={tweaks.explanationDensity}
            onChange={v => setTweak('explanationDensity', v)}
            options={[
              { value: 'minimal', label: 'Minimal' },
              { value: 'helpful', label: 'Helpful' },
              { value: 'verbose', label: 'Verbose' },
            ]}
          />
          <TweakToggle
            label="Show roadmap on welcome"
            description="Six-step preview so users know what's coming"
            value={tweaks.showRoadmap}
            onChange={v => setTweak('showRoadmap', v)}
          />
          <TweakToggle
            label="Show 'what this does' callouts"
            description="Per-step explanations of what AcreOS will do with each input"
            value={tweaks.showCallouts}
            onChange={v => setTweak('showCallouts', v)}
          />
          <TweakToggle
            label="Show Pax explainer card"
            description="Plain-language breakdown of what Pax does with phone numbers"
            value={tweaks.showPaxExplainer}
            onChange={v => setTweak('showPaxExplainer', v)}
          />
          <TweakToggle
            label="Show estimated step times"
            description="~30s, ~45s chips"
            value={tweaks.showStepTimes}
            onChange={v => setTweak('showStepTimes', v)}
          />
          <TweakToggle
            label="Show live previews"
            description="Real-time strips showing what your inputs will produce"
            value={tweaks.showLivePreviews}
            onChange={v => setTweak('showLivePreviews', v)}
          />
        </TweakSection>
        <TweakSection title="Voice" subtitle="How AcreOS talks to the user.">
          <TweakRadio
            label="Tone"
            value={tweaks.tone}
            onChange={v => setTweak('tone', v)}
            options={[
              { value: 'founder', label: 'Calm founder' },
              { value: 'plain', label: 'Plain & direct' },
              { value: 'coach', label: 'Warm coach' },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
