// Source for the script injected into the preview iframe to apply density
// overrides in real time. Same-origin so we attach via direct DOM access.
//
// Communicates with the picker (parent) via postMessage:
//   ← acreos:density-injected   { surfacePath }
//   → acreos:density-apply      { vars: { fs, lh, pad, gap } }      apply scales 0..2-ish
//   → acreos:density-clear      {}                                  remove overrides
//
// The injected stylesheet defines CSS custom properties scoped to :root and
// uses them in broad-target selectors. This is "cosmetically demonstrative"
// — the founder sees the visual feel of compact/comfy density, and the
// chosen values are saved to selections so 1.1.F can apply them properly
// (e.g., by retrofitting production CSS to consume the variables).

export const DENSITY_INJECTOR_SOURCE = String.raw`
(function(){
  if (window.__acreosDensityInjected) return;
  window.__acreosDensityInjected = true;

  var STYLE_ID = 'acreos-picker-density';
  var surfacePath = location.pathname + location.search;

  function ensureStyle(){
    var existing = document.getElementById(STYLE_ID);
    if (existing) return existing;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.dataset.acreosPickerDensity = 'true';
    document.head.appendChild(s);
    return s;
  }

  function clearStyle(){
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function applyVars(vars){
    var fs = vars.fs == null ? 1 : Number(vars.fs);
    var lh = vars.lh == null ? 1.5 : Number(vars.lh);
    var pad = vars.pad == null ? 1 : Number(vars.pad);
    var gap = vars.gap == null ? 1 : Number(vars.gap);
    var s = ensureStyle();
    // Cosmetically demonstrative overrides. Saved to selections; 1.1.F applies properly.
    s.textContent = [
      ':root {',
      '  --acreos-density-fs: ' + fs + ';',
      '  --acreos-density-lh: ' + lh + ';',
      '  --acreos-density-pad: ' + pad + ';',
      '  --acreos-density-gap: ' + gap + ';',
      '}',
      'html { font-size: calc(16px * var(--acreos-density-fs)) !important; }',
      'body, body * { line-height: var(--acreos-density-lh) !important; }',
      'main, section, header, footer, [data-acreos-section] { padding: calc(2rem * var(--acreos-density-pad)) !important; }',
      '[class*="gap-"] { gap: calc(0.75rem * var(--acreos-density-gap)) !important; }',
      '[class*="space-y-"] > * + * { margin-top: calc(1rem * var(--acreos-density-gap)) !important; }',
      '[class*="space-x-"] > * + * { margin-left: calc(1rem * var(--acreos-density-gap)) !important; }'
    ].join('\n');
  }

  window.addEventListener('message', function(e){
    if (!e.data || typeof e.data !== 'object') return;
    var t = e.data.type;
    if (t === 'acreos:density-apply') applyVars(e.data.vars || {});
    else if (t === 'acreos:density-clear') clearStyle();
  });

  try {
    window.parent.postMessage({
      type: 'acreos:density-injected', surfacePath: surfacePath
    }, '*');
  } catch (err) {}
})();
`;
