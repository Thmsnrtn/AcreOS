// acreos/command-center.jsx — the "Today" home screen

const Metric = ({ label, value, delta, positive = true, mono = true }) => (
  <div className="acr-metric">
    <div className="acr-metric-label">{label}</div>
    <div className={cx('acr-metric-value', mono && 'acr-tabnum')}>{value}</div>
    {delta != null && (
      <div className={cx('acr-metric-delta', positive ? 'acr-delta-pos' : 'acr-delta-neg')}>
        {positive ? <I.arrowUp size={11} /> : <I.arrowDn size={11} />}
        <span>{delta}</span>
      </div>
    )}
  </div>
);

const TaskRow = ({ task, onComplete }) => {
  const [done, setDone] = useState(false);
  const priTone = task.priority === 'high' ? 'neg' : task.priority === 'medium' ? 'warn' : 'neutral';
  return (
    <div className={cx('acr-task', done && 'acr-task-done')}>
      <button
        className={cx('acr-checkbox', done && 'acr-checkbox-on')}
        onClick={() => { setDone(!done); onComplete && onComplete(!done); }}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      >
        {done && <I.check size={11} />}
      </button>
      <div className="acr-task-body">
        <div className="acr-task-title">{task.title}</div>
        <div className="acr-task-meta">
          <span className="acr-task-due">{task.due}</span>
          {task.dealId && <span className="acr-task-deal">· {task.dealId}</span>}
          {task.agent && <Pill tone={task.agent === 'atlas' ? 'brand' : 'neutral'}>{task.agent === 'atlas' ? 'Atlas' : task.agent === 'pax' ? 'Pax' : 'Sophie'}</Pill>}
        </div>
      </div>
      <Pill tone={priTone}>{task.priority}</Pill>
    </div>
  );
};

const DealRow = ({ deal }) => {
  const tempClass = deal.temp === 'hot' ? 'acr-temp-hot' : deal.temp === 'warm' ? 'acr-temp-warm' : 'acr-temp-cold';
  const scoreTone = deal.atlasScore >= 85 ? 'pos' : deal.atlasScore >= 75 ? 'brand' : deal.atlasScore >= 65 ? 'warn' : 'neutral';
  return (
    <div className="acr-deal-row">
      <div className={cx('acr-temp-wick', tempClass)} />
      <div className="acr-deal-col acr-deal-parcel">
        <div className="acr-deal-id">{deal.parcel}</div>
        <div className="acr-deal-county">{deal.county} · {deal.acres}ac</div>
      </div>
      <div className="acr-deal-col acr-deal-owner">
        <div className="acr-deal-name">{deal.owner}</div>
        <div className="acr-deal-sub">{deal.mailSent > 0 ? `${deal.mailSent} mailed` : 'No contact'}</div>
      </div>
      <div className="acr-deal-col acr-deal-ask acr-tabnum">{fmtK(deal.askingK * 1000)}</div>
      <div className="acr-deal-col">
        <Pill tone={scoreTone}>
          <I.sparkle size={10} />
          {deal.atlasScore}
        </Pill>
      </div>
      <div className="acr-deal-col acr-deal-stage">{deal.stage}</div>
      <div className="acr-deal-col acr-deal-touch">
        <I.clock size={11} />
        <span>{deal.lastTouchH}h</span>
      </div>
    </div>
  );
};

const AISuggestionCard = ({ s }) => {
  const Ic = s.kind === 'atlas' ? I.sparkle : s.kind === 'pax' ? I.wand : I.bell;
  return (
    <div className="acr-sugg">
      <div className="acr-sugg-hd">
        <div className="acr-sugg-agent">
          <Ic size={13} />
          <span>{s.kind === 'atlas' ? 'Atlas' : s.kind === 'pax' ? 'Pax' : 'Sophie'}</span>
        </div>
        <button className="acr-sugg-dismiss" aria-label="Dismiss"><I.x size={12} /></button>
      </div>
      <div className="acr-sugg-title">{s.title}</div>
      <div className="acr-sugg-body">{s.body}</div>
      <div className="acr-sugg-actions">
        <Button variant="primary" size="sm">{s.primary}</Button>
        <Button variant="ghost" size="sm">{s.secondary}</Button>
      </div>
    </div>
  );
};

const ActivityItem = ({ a }) => {
  const meta = {
    atlas:  { label: 'Atlas',  color: 'var(--brand)', icon: 'sparkle' },
    pax:    { label: 'Pax',    color: 'var(--accent)', icon: 'wand' },
    sophie: { label: 'Sophie', color: 'var(--pos)',    icon: 'shield' },
    inbound:{ label: 'Reply',  color: 'var(--ink)',    icon: 'mail' },
    system: { label: 'System', color: 'var(--ink-3)',  icon: 'bolt' },
  }[a.kind] || { label: 'System', color: 'var(--ink-3)', icon: 'dot' };
  const Ic = I[meta.icon] || I.dot;
  return (
    <div className="acr-activity">
      <div className="acr-activity-icon" style={{ color: meta.color }}><Ic size={13} /></div>
      <div className="acr-activity-body">
        <div className="acr-activity-text">
          <span className="acr-activity-who">{a.who}</span>
          <span className="acr-activity-msg">{a.msg}</span>
        </div>
        <div className="acr-activity-time">{a.t} ago</div>
      </div>
    </div>
  );
};

const Greeting = () => {
  const h = new Date().getHours();
  const g = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return g;
};

const CommandCenter = () => {
  const hotDeals = DEALS.filter(d => d.temp === 'hot' || d.atlasScore >= 80).slice(0, 5);
  return (
    <div className="acr-cc">
      {/* Editorial greeting */}
      <div className="acr-cc-hero">
        <div>
          <div className="acr-eyebrow">Thursday, April 24</div>
          <h1 className="acr-cc-greeting">
            <Greeting />, Thomas.
            <span className="acr-cc-greeting-soft"> 3 deals need attention today.</span>
          </h1>
        </div>
        <div className="acr-cc-hero-actions">
          <Button variant="secondary" size="md" icon="plus">New deal</Button>
          <Button variant="primary"  size="md" icon="sparkle">Ask AcreOS</Button>
        </div>
      </div>

      {/* Metric strip */}
      <div className="acr-cc-metrics">
        <Metric label="Pipeline value"   value={fmtK(METRICS.pipelineValue)} delta={`${METRICS.pipelineDeltaPct}%`} />
        <Metric label="Deals in flight"  value={METRICS.dealsInFlight}         delta="+4"                             />
        <Metric label="Mail sent · 7d"   value={fmtInt(METRICS.mailSent7d)}    delta={`+${METRICS.mailDelta7d}`}      />
        <Metric label="Reply rate"       value={`${METRICS.repliesRate}%`}     delta={`+${METRICS.repliesDelta}pp`}   />
        <Metric label="Closed · MTD"     value={fmtK(METRICS.closedMTD)}       delta={`${METRICS.closedDelta}%`}      />
      </div>

      <div className="acr-cc-grid">
        {/* LEFT column — the operator's focus */}
        <div className="acr-cc-main">
          {/* AI suggestions */}
          <SectionTitle
            title={<span>For you <span className="acr-muted" style={{ fontWeight: 500 }}>· ambient</span></span>}
            action={<Button variant="ghost" size="sm" iconRight="arrow">See all</Button>}
          >
            <div className="acr-sugg-grid">
              {AI_SUGGESTIONS.map(s => <AISuggestionCard key={s.id} s={s} />)}
            </div>
          </SectionTitle>

          {/* Pipeline */}
          <SectionTitle
            title="Pipeline"
            action={
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" size="sm" icon="filter">Filter</Button>
                <Button variant="ghost" size="sm" iconRight="arrow">View all</Button>
              </div>
            }
          >
            <Card padded={false}>
              <div className="acr-deal-head">
                <div className="acr-deal-wick-sp" />
                <div className="acr-deal-col">Parcel</div>
                <div className="acr-deal-col">Owner</div>
                <div className="acr-deal-col">Asking</div>
                <div className="acr-deal-col">Atlas</div>
                <div className="acr-deal-col">Stage</div>
                <div className="acr-deal-col">Last touch</div>
              </div>
              <div className="acr-deal-list">
                {hotDeals.map(d => <DealRow key={d.id} deal={d} />)}
              </div>
            </Card>
          </SectionTitle>

          {/* Pipeline value chart */}
          <SectionTitle title="Pipeline value · 30 days" action={<Pill tone="pos" dot>+12.4%</Pill>}>
            <Card>
              <div className="acr-chart-hero">
                <div>
                  <div className="acr-metric-label">Today</div>
                  <div className="acr-chart-hero-value acr-tabnum">{fmtK(METRICS.pipelineValue)}</div>
                </div>
                <div className="acr-chart-legend">
                  <span><span className="acr-dot" style={{ background: 'var(--brand)' }} /> Pipeline</span>
                  <span className="acr-muted">30d avg · {fmtK(820000)}</span>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Sparkline data={SPARK} height={84} />
              </div>
            </Card>
          </SectionTitle>
        </div>

        {/* RIGHT column */}
        <div className="acr-cc-rail">
          <SectionTitle title="Today" action={<Button variant="ghost" size="sm" icon="plus" />}>
            <Card padded={false}>
              <div className="acr-task-list">
                {TASKS.map(t => <TaskRow key={t.id} task={t} />)}
              </div>
            </Card>
          </SectionTitle>

          <SectionTitle title="Activity" action={<Button variant="ghost" size="sm" iconRight="arrow">All</Button>}>
            <Card>
              <div className="acr-activity-list">
                {ACTIVITY.map(a => <ActivityItem key={a.id} a={a} />)}
              </div>
            </Card>
          </SectionTitle>

          <Card>
            <div className="acr-quiet-hd">
              <I.leaf size={14} style={{ color: 'var(--pos)' }} />
              <span>Autonomous Executor</span>
              <Pill tone="pos" dot>Running</Pill>
            </div>
            <div className="acr-quiet-body">
              Last cycle · 12 min ago. 4 actions taken, 1 needed founder approval.
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
              <Button variant="subtle" size="sm">Review log</Button>
              <Button variant="ghost" size="sm" icon="pause">Pause</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const CC_CSS = `
  .acr-cc { display: flex; flex-direction: column; gap: 28px; }
  .acr-cc-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-top: 4px; }
  .acr-cc-greeting {
    font: 600 32px/1.15 var(--font-display); letter-spacing: -0.03em; color: var(--ink);
    margin: 4px 0 0; text-wrap: pretty; max-width: 680px;
  }
  .acr-cc-greeting-soft { color: var(--ink-3); font-weight: 500; }
  .acr-cc-hero-actions { display: flex; gap: 8px; align-items: center; }

  .acr-cc-metrics {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 14px; box-shadow: var(--shadow-1);
    overflow: hidden;
  }
  .acr-metric { padding: 16px 20px; display: flex; flex-direction: column; gap: 6px; border-right: 0.5px solid var(--line-soft); }
  .acr-metric:last-child { border-right: 0; }
  .acr-metric-label { font: 500 11.5px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0; }
  .acr-metric-value { font: 600 22px/1.1 var(--font-display); letter-spacing: -0.02em; color: var(--ink); }
  .acr-metric-delta { display: inline-flex; align-items: center; gap: 2px; font: 500 11px/1 var(--font-sans); }
  .acr-delta-pos { color: var(--pos); }
  .acr-delta-neg { color: var(--neg); }

  .acr-cc-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: flex-start; }
  .acr-cc-main, .acr-cc-rail { display: flex; flex-direction: column; gap: 28px; }
  @media (max-width: 1180px) { .acr-cc-grid { grid-template-columns: 1fr; } .acr-cc-metrics { grid-template-columns: repeat(2, 1fr); } }

  .acr-section { display: flex; flex-direction: column; }

  /* AI suggestions */
  .acr-sugg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 1100px) { .acr-sugg-grid { grid-template-columns: 1fr; } }
  .acr-sugg {
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 14px; padding: 14px 14px 12px; box-shadow: var(--shadow-1);
    display: flex; flex-direction: column; gap: 6px;
    position: relative; overflow: hidden;
  }
  .acr-sugg::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--brand), var(--accent));
    opacity: .7;
  }
  .acr-sugg-hd { display: flex; justify-content: space-between; align-items: center; }
  .acr-sugg-agent { display: inline-flex; align-items: center; gap: 5px; color: var(--brand); font: 600 11px/1 var(--font-sans); letter-spacing: 0.01em; }
  .acr-sugg-dismiss { width: 22px; height: 22px; border: 0; background: transparent; color: var(--ink-4); border-radius: 5px; cursor: default; }
  .acr-sugg-dismiss:hover { background: var(--surface-2); color: var(--ink-2); }
  .acr-sugg-title { font: 600 14px/1.3 var(--font-display); letter-spacing: -0.01em; color: var(--ink); }
  .acr-sugg-body { font: 400 12.5px/1.45 var(--font-sans); color: var(--ink-2); text-wrap: pretty; }
  .acr-sugg-actions { display: flex; gap: 4px; margin-top: 6px; }

  /* Deals table */
  .acr-deal-head, .acr-deal-row {
    display: grid;
    grid-template-columns: 4px minmax(160px,1.2fr) minmax(140px,1fr) 90px 80px minmax(120px,.9fr) 70px;
    align-items: center; gap: 16px; padding: 10px 18px;
  }
  .acr-deal-head {
    font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink-3); border-bottom: 0.5px solid var(--line);
    background: var(--surface-2);
  }
  .acr-deal-row { border-bottom: 0.5px solid var(--line-soft); transition: background .1s; }
  .acr-deal-row:last-child { border-bottom: 0; }
  .acr-deal-row:hover { background: var(--surface-2); }
  .acr-deal-wick-sp { width: 4px; }
  .acr-temp-wick { width: 3px; height: 28px; border-radius: 2px; background: var(--line); }
  .acr-temp-hot  { background: var(--neg); box-shadow: 0 0 10px var(--neg-soft); }
  .acr-temp-warm { background: var(--warn); }
  .acr-temp-cold { background: var(--ink-4); }
  .acr-deal-id { font: 500 13px/1.2 var(--font-mono); color: var(--ink); letter-spacing: 0; }
  .acr-deal-county, .acr-deal-sub { font: 500 11.5px/1.2 var(--font-sans); color: var(--ink-3); margin-top: 3px; }
  .acr-deal-name { font: 500 13px/1.2 var(--font-sans); color: var(--ink); }
  .acr-deal-ask  { font: 600 13px/1 var(--font-sans); color: var(--ink); }
  .acr-deal-stage { font: 500 12.5px/1 var(--font-sans); color: var(--ink-2); }
  .acr-deal-touch { display: inline-flex; align-items: center; gap: 4px; font: 500 12px/1 var(--font-sans); color: var(--ink-3); }

  /* Tasks */
  .acr-task-list { display: flex; flex-direction: column; }
  .acr-task { display: flex; gap: 10px; padding: 10px 14px; border-bottom: 0.5px solid var(--line-soft); align-items: flex-start; }
  .acr-task:last-child { border-bottom: 0; }
  .acr-task:hover { background: var(--surface-2); }
  .acr-task-done .acr-task-title { color: var(--ink-3); text-decoration: line-through; }
  .acr-checkbox {
    width: 16px; height: 16px; border-radius: 5px; border: 1px solid var(--line);
    background: var(--surface); display: inline-flex; align-items: center; justify-content: center;
    margin-top: 1px; cursor: default; color: var(--brand-ink); flex-shrink: 0;
    transition: background .1s, border-color .1s;
  }
  .acr-checkbox:hover { border-color: var(--ink-3); }
  .acr-checkbox-on { background: var(--brand); border-color: var(--brand); }
  .acr-task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .acr-task-title { font: 500 12.5px/1.35 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .acr-task-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font: 500 11px/1 var(--font-sans); color: var(--ink-3); }
  .acr-task-due  { color: var(--ink-2); }

  /* Activity */
  .acr-activity-list { display: flex; flex-direction: column; gap: 10px; }
  .acr-activity { display: flex; gap: 10px; }
  .acr-activity-icon { width: 24px; height: 24px; border-radius: 6px; background: var(--surface-2); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acr-activity-body { flex: 1; min-width: 0; }
  .acr-activity-text { font: 500 12.5px/1.4 var(--font-sans); color: var(--ink-2); text-wrap: pretty; }
  .acr-activity-who  { color: var(--ink); font-weight: 600; margin-right: 4px; }
  .acr-activity-msg  { font-weight: 400; color: var(--ink-2); }
  .acr-activity-time { font: 500 11px/1 var(--font-sans); color: var(--ink-3); margin-top: 3px; }

  /* Chart hero */
  .acr-chart-hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .acr-chart-hero-value { font: 600 26px/1 var(--font-display); letter-spacing: -0.02em; color: var(--ink); margin-top: 4px; }
  .acr-chart-legend { display: flex; gap: 14px; font: 500 11.5px/1 var(--font-sans); color: var(--ink-2); align-items: center; }
  .acr-chart-legend > span { display: inline-flex; align-items: center; gap: 6px; }
  .acr-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  /* Quiet card (Autonomous Executor) */
  .acr-quiet-hd { display: flex; align-items: center; gap: 8px; font: 600 13px/1 var(--font-sans); color: var(--ink); }
  .acr-quiet-hd > span:nth-child(2) { flex: 1; letter-spacing: -0.005em; }
  .acr-quiet-body { font: 400 12.5px/1.5 var(--font-sans); color: var(--ink-2); margin-top: 10px; text-wrap: pretty; }
`;

Object.assign(window, { CommandCenter, CC_CSS });
