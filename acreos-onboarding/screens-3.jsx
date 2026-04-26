// acreos-onboarding/screens-3.jsx
// Phone · Billing · Reveal

const { useState: useState3, useRef: useRef3 } = React;

// ─────────────────────────────────── 4 · PHONE
function ScreenPhone({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime, OBPaxExplainer } = window.OBClarity || {};
  const [otpSent, setOtpSent] = useState3(false);
  const [otp, setOtp] = useState3(['', '', '', '', '', '']);
  const refs = [useRef3(), useRef3(), useRef3(), useRef3(), useRef3(), useRef3()];

  const sendOtp = () => {
    if (data.phone && data.phone.length >= 7) setOtpSent(true);
  };

  const onOtpChange = (i, val) => {
    const v = val.replace(/\D/g, '').slice(0, 1);
    const next = [...otp]; next[i] = v;
    setOtp(next);
    if (v && i < 5) refs[i + 1].current?.focus();
    if (next.every(x => x)) set('phoneVerified', true);
  };

  return (
    <div className="ob-screen">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 6 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~45 seconds" />}
      </div>
      <h1 className="ob-title">Where should sellers reach Pax?</h1>
      <p className="ob-sub">
        We give Pax a phone number that forwards SMS replies into your inbox. Voicemail gets transcribed and drafted. You can use a new number we provision, or port your existing one later.
      </p>

      {tweaks.showPaxExplainer && OBPaxExplainer && <OBPaxExplainer />}

      {!otpSent ? (
        <>
          <div className="ob-field">
            <div className="ob-label">Your mobile number</div>
            <p className="ob-hint" style={{ marginTop: 0, marginBottom: 10 }}>
              Used for two-factor auth and emergency alerts only. Sellers won't see this.
            </p>
            <div className="ob-phone-row">
              <select
                className="ob-select ob-phone-cc"
                value={data.countryCode || '+1'}
                onChange={e => set('countryCode', e.target.value)}
              >
                <option>+1</option>
                <option>+44</option>
                <option>+61</option>
                <option>+52</option>
              </select>
              <input
                className="ob-input"
                type="tel"
                placeholder="(555) 555-5555"
                value={data.phone || ''}
                onChange={e => set('phone', e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <div className="ob-field">
            <div className="ob-label">Pax's outbound number</div>
            <p className="ob-hint" style={{ marginTop: 0, marginBottom: 10 }}>
              We'll provision a local number in your primary county. Sellers see this on caller ID.
            </p>
            <div className="ob-pills">
              {['Apache, AZ — (928) 555-…', 'Park, CO — (719) 555-…', 'Catron, NM — (575) 555-…', 'Pick later'].map((label, i) => (
                <button
                  key={label}
                  className={`ob-pill ${(data.paxNumber ?? 0) === i ? 'is-on' : ''}`}
                  onClick={() => set('paxNumber', i)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="ob-btn ob-btn-secondary"
            onClick={sendOtp}
            disabled={!data.phone || data.phone.length < 7}
          >
            Send verification code
          </button>
        </>
      ) : (
        <>
          <div className="ob-field">
            <div className="ob-label">Enter the 6-digit code we just sent</div>
            <p className="ob-hint" style={{ marginTop: 0, marginBottom: 16 }}>
              Sent to {data.countryCode || '+1'} {data.phone}. Should arrive in a few seconds.
            </p>
            <div className="ob-otp">
              {otp.map((v, i) => (
                <input
                  key={i}
                  ref={refs[i]}
                  type="text"
                  inputMode="numeric"
                  maxLength="1"
                  value={v}
                  onChange={e => onOtpChange(i, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Backspace' && !otp[i] && i > 0) refs[i - 1].current?.focus();
                  }}
                />
              ))}
            </div>
            <p className="ob-hint" style={{ marginTop: 16 }}>
              Didn't get it?{' '}
              <button onClick={() => setOtpSent(false)} style={{ color: 'var(--brand)', fontWeight: 600 }}>
                Use a different number
              </button>
              {' · '}
              <button style={{ color: 'var(--brand)', fontWeight: 600 }}>
                Resend code
              </button>
            </p>
          </div>
        </>
      )}

      <div className="ob-mini-msg">
        <div className="ob-mini-msg-icon">P</div>
        <div className="ob-mini-msg-text">
          <b>Pax says:</b> I'll only call sellers during the hours you set in Settings. Default is 9am–7pm in their local time. I'll never call after-hours without you flipping that switch.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────── 5 · BILLING
function ScreenBilling({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime } = window.OBClarity || {};
  const plan = data.plan || 'operator';
  const defer = data.deferBilling || false;

  return (
    <div className="ob-screen ob-screen-wide">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 7 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~30 seconds" />}
      </div>
      <h1 className="ob-title">Pick a plan to trial.</h1>
      <p className="ob-sub">
        14 days free, no charge today, cancel from settings any time. We'll email a reminder 3 days before the trial ends.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout title="What 'free trial' means here">
          <b>No charge today.</b> Atlas, Pax, and Sophie all run at full power for 14 days — pulling parcels, sending mail, drafting replies. <b>You only pay if you keep going past day 14.</b> If you skip the card now, you'll get an email on day 11 with a one-click add link.
        </OBCallout>
      )}

      <div className="ob-bill-grid">
        <button
          className={`ob-plan ${plan === 'solo' ? 'is-on' : ''}`}
          onClick={() => set('plan', 'solo')}
        >
          <div className="ob-plan-name">Solo</div>
          <div className="ob-plan-desc">For investors closing 1–4 deals a month.</div>
          <div className="ob-plan-price">
            <span className="ob-plan-amt">$199</span>
            <span className="ob-plan-per">/mo</span>
          </div>
          <span className="ob-plan-trial">14-day free trial</span>
          <ul className="ob-plan-feats">
            <li>1 user · 3 counties</li>
            <li>All 3 agents</li>
            <li>500 mailers / mo</li>
            <li>Pax inbox · audit log</li>
          </ul>
        </button>

        <button
          className={`ob-plan ${plan === 'operator' ? 'is-on' : ''}`}
          onClick={() => set('plan', 'operator')}
        >
          <span className="ob-plan-flag">Recommended</span>
          <div className="ob-plan-name">Operator</div>
          <div className="ob-plan-desc">For partnerships and small teams.</div>
          <div className="ob-plan-price">
            <span className="ob-plan-amt">$499</span>
            <span className="ob-plan-per">/mo</span>
          </div>
          <span className="ob-plan-trial">14-day free trial</span>
          <ul className="ob-plan-feats">
            <li>5 users · unlimited counties</li>
            <li>Automation builder</li>
            <li>2,500 mailers / mo</li>
            <li>Sophie note servicing</li>
            <li>Roles + permissions</li>
          </ul>
        </button>
      </div>

      {!defer ? (
        <>
          <div style={{ font: '600 13px/1 var(--font-sans)', color: 'var(--ink)', marginBottom: 10 }}>
            Card on file
          </div>
          <p className="ob-hint" style={{ marginTop: 0, marginBottom: 14 }}>
            Not charged until your trial ends. Stored in Stripe.
          </p>
          <div className="ob-card-form">
            <div className="ob-card-form-grid">
              <div className="ob-field-full">
                <input className="ob-input" placeholder="Card number" />
              </div>
              <input className="ob-input" placeholder="MM / YY" />
              <input className="ob-input" placeholder="CVC" />
              <input className="ob-input" placeholder="ZIP" />
            </div>
          </div>
          <button
            className="ob-skip"
            onClick={() => set('deferBilling', true)}
            style={{ display: 'block', textAlign: 'left' }}
          >
            I'd rather skip this and add it before the trial ends →
          </button>
        </>
      ) : (
        <div className="ob-defer">
          <div className="ob-defer-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <polyline points="12 7 12 12 15 14"/>
            </svg>
          </div>
          <div className="ob-defer-text">
            <b>Billing deferred.</b> We'll email you 3 days before the trial ends with a one-click link to add a card. No interruption.
            {' · '}
            <button onClick={() => set('deferBilling', false)} style={{ color: 'var(--brand)', fontWeight: 600 }}>
              Add card now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────── 6 · REVEAL
function ScreenReveal({ data, finish }) {
  const startTour = data.startTour !== false;
  return (
    <div className="ob-screen ob-reveal">
      <div className="ob-reveal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>
      <h1 className="ob-reveal-title">You're all set.</h1>
      <p className="ob-reveal-sub">
        The agents are starting up tonight. Tomorrow morning, here's what you'll see when you open AcreOS:
      </p>

      <div className="ob-tomorrow">
        <div className="ob-tomorrow-head">
          <div className="ob-tomorrow-h">Tomorrow's Command Center · 6:42 am</div>
          <div className="ob-tomorrow-when">overnight summary</div>
        </div>
        <div className="ob-tomorrow-row">
          <div className="ob-tomorrow-icon ob-tom-atlas">A</div>
          <div className="ob-tomorrow-text">
            <b>Atlas</b> pulled <b>{(data.counties?.length || 3) * 32}</b> parcels matching your buy-box overnight. {Math.floor((data.counties?.length || 3) * 6)} are flagged as worth your time today.
          </div>
        </div>
        <div className="ob-tomorrow-row">
          <div className="ob-tomorrow-icon ob-tom-pax">P</div>
          <div className="ob-tomorrow-text">
            <b>Pax</b> queued your first mail batch. <b>{data.dealsTarget ? data.dealsTarget * 12 : 50}</b> mailers ready for your review before they go out at 9 am.
          </div>
        </div>
        <div className="ob-tomorrow-row">
          <div className="ob-tomorrow-icon ob-tom-sophie">S</div>
          <div className="ob-tomorrow-text">
            <b>Sophie</b> is on standby. As your first deals close, she'll start the ledger automatically.
          </div>
        </div>
      </div>

      <button className="ob-btn ob-btn-primary ob-btn-arrow" onClick={finish}>
        {startTour ? 'Open AcreOS · take the tour' : 'Open AcreOS'}
      </button>
      <label style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'default', font: '500 12.5px/1 var(--font-sans)', color: 'var(--ink-3)' }}>
        <input
          type="checkbox"
          checked={startTour}
          onChange={e => data && (data.startTour = e.target.checked, window.dispatchEvent(new Event('ob-tour-toggle')))}
          style={{ accentColor: 'var(--brand)' }}
        />
        Show me the 60-second tour when I land
      </label>
      <div style={{ marginTop: 20, font: '500 13px/1.4 var(--font-sans)', color: 'var(--ink-3)' }}>
        We'll send a Slack-style daily digest at 6 am with everything the agents did overnight.
      </div>
    </div>
  );
}

window.OBScreens3 = { ScreenPhone, ScreenBilling, ScreenReveal };
