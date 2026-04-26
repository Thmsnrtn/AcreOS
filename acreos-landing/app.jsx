// acreos-landing/app.jsx
// Mounts the page, wires Tweaks for tone selection.

const TONES = [
  { id: 'plain', name: 'Operator', desc: 'Direct, plainspoken, builder-to-builder' },
  { id: 'aspirational', name: 'OS', desc: 'Aspirational platform language' },
  { id: 'letter', name: 'Letter', desc: 'Founder voice, first-person, warm' },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tone": "letter",
  "showHowItWorks": true,
  "showAgents": true,
  "showDayInLife": true,
  "showFeatures": true,
  "showQuotes": true,
  "showFounder": true,
  "showPricing": true,
  "showFAQ": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const tone = tweaks.tone;
  const copy = window.LP_COPY[tone];

  const { Hero, HowItWorks, Agents } = window.Section1;
  const { DayInLife, Features, Quotes } = window.Section2;
  const { FounderNote, Pricing, FAQ, FinalCTA, Footer } = window.Section3;

  return (
    <>
      <Hero tone={tone} copy={copy} />
      {tweaks.showHowItWorks && <HowItWorks copy={copy} />}
      {tweaks.showAgents && <Agents copy={copy} />}
      {tweaks.showDayInLife && <DayInLife copy={copy} />}
      {tweaks.showFeatures && <Features copy={copy} />}
      {tweaks.showQuotes && <Quotes copy={copy} />}
      {tweaks.showFounder && <FounderNote copy={copy} />}
      {tweaks.showPricing && <Pricing copy={copy} />}
      {tweaks.showFAQ && <FAQ copy={copy} />}
      <FinalCTA copy={copy} />
      <Footer />

      <window.TweaksPanel title="Landing page tweaks">
        <window.TweakSection title="Voice & tone">
          <window.TweakRadio
            label="Copy direction"
            value={tweaks.tone}
            options={TONES.map(t => ({ value: t.id, label: t.name }))}
            onChange={v => setTweak('tone', v)}
          />
          <div style={{
            font: '500 11px/1.4 Inter, sans-serif',
            color: '#8F7A52',
            padding: '0 12px 8px',
            marginTop: '-4px'
          }}>
            {TONES.find(t => t.id === tweaks.tone)?.desc}
          </div>
        </window.TweakSection>
        <window.TweakSection title="Sections">
          <window.TweakToggle label="How it works" value={tweaks.showHowItWorks} onChange={v => setTweak('showHowItWorks', v)} />
          <window.TweakToggle label="The agents" value={tweaks.showAgents} onChange={v => setTweak('showAgents', v)} />
          <window.TweakToggle label="Day in the life" value={tweaks.showDayInLife} onChange={v => setTweak('showDayInLife', v)} />
          <window.TweakToggle label="Features grid" value={tweaks.showFeatures} onChange={v => setTweak('showFeatures', v)} />
          <window.TweakToggle label="Quotes" value={tweaks.showQuotes} onChange={v => setTweak('showQuotes', v)} />
          <window.TweakToggle label="Founder note" value={tweaks.showFounder} onChange={v => setTweak('showFounder', v)} />
          <window.TweakToggle label="Pricing" value={tweaks.showPricing} onChange={v => setTweak('showPricing', v)} />
          <window.TweakToggle label="FAQ" value={tweaks.showFAQ} onChange={v => setTweak('showFAQ', v)} />
        </window.TweakSection>
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('lp-content')).render(<App />);
