// acreos/shell.jsx — sidebar + top bar + page frame

const { useState, useEffect, useRef } = React;

const Logo = ({ size = 22, collapsed = false }) => (
  <div className="acr-logo" style={{ fontSize: size * 0.7 }}>
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="acr-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="var(--brand)"/>
          <stop offset="100%" stopColor="var(--accent)"/>
        </linearGradient>
      </defs>
      <path d="M5 6 L27 4 L29 18 L24 27 L7 26 L3 14 Z" fill="url(#acr-mark)" />
      <path d="M16 9 L22 22 L18.75 22 L17.5 19 L14 19 L12.75 22 L9.5 22 Z M15 17 L17 17 L16 14 Z"
            fill="var(--surface)" fillOpacity="0.95"/>
    </svg>
    {!collapsed && <span className="acr-logo-word">AcreOS</span>}
  </div>
);

const NavItem = ({ item, active, onClick, collapsed }) => {
  const Ic = I[item.icon] || I.dot;
  return (
    <button
      onClick={onClick}
      className={cx('acr-nav-item', active && 'acr-nav-item-active')}
      title={collapsed ? item.label : undefined}
      data-tour-nav={item.id}
    >
      <Ic size={16} />
      {!collapsed && <span className="acr-nav-label">{item.label}</span>}
      {!collapsed && item.badge != null && (
        <span className="acr-nav-badge">{item.badge}</span>
      )}
    </button>
  );
};

const Sidebar = ({ active, onNavigate, collapsed, workspace, onOpenPalette }) => (
  <aside className={cx('acr-sidebar', collapsed && 'acr-sidebar-collapsed')}>
    <div className="acr-sidebar-hd">
      <Logo collapsed={collapsed} />
      {!collapsed && (
        <button className="acr-ws" title="Workspace">
          <span className="acr-ws-name">{workspace}</span>
          <I.chevDn size={12} />
        </button>
      )}
    </div>

    {!collapsed && (
      <button className="acr-search-trigger" onClick={onOpenPalette}>
        <I.search size={14} />
        <span>Search or jump to…</span>
        <span className="acr-search-kbd"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </button>
    )}
    {collapsed && (
      <button className="acr-sidebar-icon" onClick={onOpenPalette} title="Search (⌘K)">
        <I.search size={16} />
      </button>
    )}

    <nav className="acr-nav">
      {NAV.filter(g => !g.hidden || window.__founderMode).map(g => (
        <div className={cx('acr-nav-group', g.hidden && 'acr-nav-group-founder')} key={g.group}>
          {!collapsed && <div className="acr-nav-group-title">{g.hidden ? '⌁ ' : ''}{g.group}</div>}
          {g.items.map(it => (
            <NavItem key={it.id} item={it} active={active === it.id} onClick={() => onNavigate(it.id)} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>

    <div className="acr-nav-footer">
      {NAV_FOOTER.map(it => (
        <NavItem key={it.id} item={it} active={active === it.id} onClick={() => onNavigate(it.id)} collapsed={collapsed} />
      ))}
      <div className="acr-user">
        <Avatar name="Thomas Norton" size={26} tone="accent" />
        {!collapsed && (
          <div className="acr-user-meta">
            <div className="acr-user-name">Thomas Norton</div>
            <div className="acr-user-plan">Scale · founder</div>
          </div>
        )}
      </div>
    </div>
  </aside>
);

const TopBar = ({ title, crumbs = [], onToggleDark, dark, onToggleTweaks, onOpenPalette, onAmbient, onOpenDrawer, children }) => (
  <header className="acr-topbar">
    <div className="acr-topbar-l">
      {onOpenDrawer && (
        <button className="acr-icon-btn acr-mobile-only" title="Menu" onClick={onOpenDrawer}>
          <I.menu size={16} />
        </button>
      )}
      {crumbs.length > 0 && (
        <nav className="acr-crumbs">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <I.chevRt size={12} className="acr-crumb-sep" />}
              <span className={cx('acr-crumb', i === crumbs.length - 1 && 'acr-crumb-curr')}>{c}</span>
            </React.Fragment>
          ))}
        </nav>
      )}
      {!crumbs.length && <h1 className="acr-page-title">{title}</h1>}
    </div>
    <div className="acr-topbar-c">{children}</div>
    <div className="acr-topbar-r">
      <button className="acr-icon-btn" title="Ask (⌘J)" onClick={onAmbient}>
        <I.sparkle size={16} />
      </button>
      <button className="acr-icon-btn" title="Notifications">
        <I.bell size={16} />
        <span className="acr-dot-notify" />
      </button>
      <button className="acr-icon-btn" title={dark ? 'Light mode' : 'Dark mode'} onClick={onToggleDark}>
        {dark ? <I.sun size={16} /> : <I.moon size={16} />}
      </button>
    </div>
  </header>
);

const SHELL_CSS = `
  .acr-app { display: grid; grid-template-columns: auto 1fr; min-height: 100vh; color: var(--ink); }

  /* ─────────────── Sidebar */
  .acr-sidebar {
    width: 240px; background: var(--sidebar-bg);
    border-right: 0.5px solid var(--line);
    display: flex; flex-direction: column; padding: 14px 10px;
    position: sticky; top: 0; height: 100vh; gap: 4px;
    transition: width .2s cubic-bezier(.3,.7,.4,1);
  }
  .acr-sidebar-collapsed { width: 60px; padding: 14px 8px; align-items: center; }

  .acr-sidebar-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 2px 6px 8px; gap: 8px; min-height: 32px;
  }
  .acr-sidebar-collapsed .acr-sidebar-hd { justify-content: center; padding: 2px 0 10px; }

  .acr-logo { display: inline-flex; align-items: center; gap: 7px; color: var(--ink); }
  .acr-logo-word { font: 600 14px/1 var(--font-display); letter-spacing: -0.015em; }

  .acr-ws {
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 0; color: var(--ink-3);
    font: 500 11.5px/1 var(--font-sans); letter-spacing: -0.005em;
    padding: 5px 6px; border-radius: 6px; cursor: default;
  }
  .acr-ws:hover { background: var(--surface-2); color: var(--ink-2); }
  .acr-ws-name { color: var(--ink-2); }

  .acr-search-trigger {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 8px; padding: 6px 8px 6px 10px;
    color: var(--ink-3); font: 500 12px/1 var(--font-sans);
    cursor: default; margin: 2px 0 10px; width: 100%;
    transition: background .12s, border-color .12s;
  }
  .acr-search-trigger:hover { background: var(--surface-2); }
  .acr-search-trigger > span:nth-child(2) { flex: 1; text-align: left; }
  .acr-search-kbd { display: inline-flex; gap: 2px; }

  .acr-sidebar-icon {
    width: 36px; height: 36px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-3); background: transparent; border: 0; cursor: default; margin: 2px 0 6px;
  }
  .acr-sidebar-icon:hover { background: var(--surface-2); color: var(--ink); }

  .acr-nav { display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; padding: 4px 0; }
  .acr-nav::-webkit-scrollbar { width: 0; }
  .acr-nav-group { display: flex; flex-direction: column; gap: 1px; }
  .acr-nav-group-title {
    font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.07em;
    text-transform: uppercase; color: var(--ink-4); padding: 4px 10px 6px;
  }

  .acr-nav-item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 6px 9px; border-radius: 7px; background: transparent; border: 0;
    color: var(--ink-2); font: 500 13px/1 var(--font-sans); letter-spacing: -0.005em;
    cursor: default; position: relative;
    transition: background .1s, color .1s;
  }
  .acr-sidebar-collapsed .acr-nav-item { justify-content: center; padding: 8px; }
  .acr-nav-item:hover { background: var(--surface-2); color: var(--ink); }
  .acr-nav-item-active {
    background: var(--surface); color: var(--ink);
    box-shadow: var(--shadow-1), inset 0 0 0 0.5px var(--line);
  }
  .acr-nav-item-active::before {
    content: ''; position: absolute; left: -10px; top: 50%; transform: translateY(-50%);
    width: 2px; height: 14px; border-radius: 2px; background: var(--brand);
  }
  .acr-sidebar-collapsed .acr-nav-item-active::before { display: none; }
  .acr-nav-label { flex: 1; text-align: left; }
  .acr-nav-badge {
    background: var(--surface-2); color: var(--ink-3);
    border-radius: 999px; padding: 1px 7px; font-size: 10.5px; font-weight: 600;
    min-width: 18px; text-align: center; border: 0.5px solid var(--line-soft);
  }
  .acr-nav-item-active .acr-nav-badge { background: var(--brand-soft); color: var(--brand); border-color: transparent; }

  .acr-nav-footer { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 0.5px solid var(--line-soft); }
  .acr-user {
    display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 8px;
    cursor: default; margin-top: 2px;
  }
  .acr-user:hover { background: var(--surface-2); }
  .acr-user-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .acr-user-name { font: 500 12.5px/1.1 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .acr-user-plan { font: 500 10.5px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0; }

  .acr-nav-group-founder .acr-nav-group-title { color: var(--brand); letter-spacing: 0.1em; }
  .acr-nav-group-founder .acr-nav-item { color: var(--ink-2); }

  /* ─────────────── Top bar */
  .acr-main { display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  .acr-topbar {
    display: flex; align-items: center; gap: 16px; padding: 14px 24px;
    border-bottom: 0.5px solid var(--line);
    background: color-mix(in srgb, var(--bg) 75%, transparent);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    position: sticky; top: 0; z-index: 20;
  }
  .acr-topbar-l { flex: 1; min-width: 0; }
  .acr-topbar-c { display: flex; gap: 8px; }
  .acr-topbar-r { display: flex; gap: 2px; align-items: center; }

  .acr-page-title { font: 600 18px/1.2 var(--font-display); letter-spacing: -0.02em; color: var(--ink); margin: 0; }
  .acr-crumbs { display: flex; align-items: center; gap: 6px; font: 500 13px/1 var(--font-sans); }
  .acr-crumb { color: var(--ink-3); }
  .acr-crumb-curr { color: var(--ink); font-weight: 600; }
  .acr-crumb-sep { color: var(--ink-4); }

  .acr-icon-btn {
    width: 32px; height: 32px; border-radius: 8px; border: 0; background: transparent;
    color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; position: relative;
    cursor: default; transition: background .1s, color .1s;
  }
  .acr-icon-btn:hover { background: var(--surface-2); color: var(--ink); }
  .acr-dot-notify {
    position: absolute; top: 8px; right: 8px; width: 6px; height: 6px; border-radius: 50%;
    background: var(--brand); box-shadow: 0 0 0 2px var(--bg);
  }

  /* ─────────────── Content */
  .acr-content { flex: 1; padding: 28px 32px 48px; max-width: 1480px; width: 100%; margin: 0 auto; }
  .acr-content-wide { max-width: none; }
`;

Object.assign(window, { Sidebar, TopBar, Logo, NavItem, SHELL_CSS });
