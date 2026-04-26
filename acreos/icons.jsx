// acreos/icons.jsx
// Minimal line icons — stroke=1.5, rounded. Inherits currentColor.

const Icon = ({ d, size = 16, stroke = 1.5, fill = 'none', children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

const I = {
  home:    (p) => <Icon {...p}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></Icon>,
  pipeline:(p) => <Icon {...p}><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/></Icon>,
  map:     (p) => <Icon {...p}><path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2z"/><path d="M9 3v16M15 5v16"/></Icon>,
  mail:    (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Icon>,
  chart:   (p) => <Icon {...p}><path d="M3 20h18"/><path d="M6 16V9M11 16V5M16 16v-6M20 16v-3"/></Icon>,
  coin:    (p) => <Icon {...p}><circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></Icon>,
  settings:(p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></Icon>,
  spark:   (p) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></Icon>,
  search:  (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>,
  plus:    (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  arrow:   (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>,
  arrowUp: (p) => <Icon {...p}><path d="M12 19V5M6 11l6-6 6 6"/></Icon>,
  arrowDn: (p) => <Icon {...p}><path d="M12 5v14M18 13l-6 6-6-6"/></Icon>,
  check:   (p) => <Icon {...p}><path d="m5 12 4.5 4.5L20 6"/></Icon>,
  x:       (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>,
  dot:     (p) => <Icon {...p} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="3"/></Icon>,
  bolt:    (p) => <Icon {...p}><path d="M13 3 4 14h7l-1 7 9-11h-7z"/></Icon>,
  calendar:(p) => <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></Icon>,
  bell:    (p) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 20a2 2 0 0 0 4 0"/></Icon>,
  user:    (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>,
  users:   (p) => <Icon {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7M15 14a6 6 0 0 1 6 6"/></Icon>,
  phone:   (p) => <Icon {...p}><path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></Icon>,
  note:    (p) => <Icon {...p}><path d="M5 3h11l3 3v15H5z"/><path d="M16 3v3h3M8 10h8M8 14h8M8 18h5"/></Icon>,
  folder:  (p) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></Icon>,
  clock:   (p) => <Icon {...p}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></Icon>,
  filter:  (p) => <Icon {...p}><path d="M3 5h18l-7 9v5l-4-2v-3z"/></Icon>,
  layers:  (p) => <Icon {...p}><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 18l9 5 9-5"/></Icon>,
  play:    (p) => <Icon {...p}><path d="M7 5v14l12-7z"/></Icon>,
  pause:   (p) => <Icon {...p}><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="13" y="5" width="4" height="14" rx="1"/></Icon>,
  cmd:     (p) => <Icon {...p}><path d="M9 5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2z"/></Icon>,
  sun:     (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.5 1.5M18 18l1.5 1.5M4.5 19.5l1.5-1.5M18 6l1.5-1.5"/></Icon>,
  moon:    (p) => <Icon {...p}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></Icon>,
  sliders: (p) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="16" cy="12" r="2" fill="var(--bg)"/><circle cx="10" cy="18" r="2" fill="var(--bg)"/></Icon>,
  inbox:   (p) => <Icon {...p}><path d="M3 13h5l2 3h4l2-3h5"/><path d="M4 13l2-8h12l2 8v6H4z"/></Icon>,
  wand:    (p) => <Icon {...p}><path d="m4 20 12-12M14 6l4 4M17 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></Icon>,
  house:   (p) => <Icon {...p}><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></Icon>,
  leaf:    (p) => <Icon {...p}><path d="M5 19c6 0 14-3 14-14 0 0-8-1-12 3s-3 10-2 11z"/><path d="M5 19 15 9"/></Icon>,
  shield:  (p) => <Icon {...p}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></Icon>,
  key:     (p) => <Icon {...p}><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l3 3"/></Icon>,
  pin:     (p) => <Icon {...p}><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></Icon>,
  chevDn:  (p) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>,
  chevRt:  (p) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>,
  chevLt:  (p) => <Icon {...p}><path d="m15 6-6 6 6 6"/></Icon>,
  menu:    (p) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16"/></Icon>,
  link:    (p) => <Icon {...p}><path d="M10 14a4 4 0 0 1 0-6l3-3a4 4 0 1 1 6 6l-1.5 1.5"/><path d="M14 10a4 4 0 0 1 0 6l-3 3a4 4 0 1 1-6-6l1.5-1.5"/></Icon>,
  sparkle: (p) => <Icon {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/></Icon>,
};

Object.assign(window, { Icon, I });
