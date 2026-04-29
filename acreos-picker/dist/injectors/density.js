// AcreOS picker — density injector. REMOVE_BEFORE_LAUNCH (Gap 1.1.G).
// Listens for postMessage from the picker and writes a <style> block that
// applies CSS variable overrides for density (font-size scale, line-height,
// section padding, item spacing) in real time.

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
