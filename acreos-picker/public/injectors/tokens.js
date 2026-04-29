// AcreOS picker — token injector. REMOVE_BEFORE_LAUNCH (Gap 1.1.G).
// Listens for postMessage from the picker and writes a <style> block that
// applies CSS custom property overrides (color tokens like --acr-brand).

(function(){
  if (window.__acreosTokensInjected) return;
  window.__acreosTokensInjected = true;

  var STYLE_ID = 'acreos-picker-tokens';
  var surfacePath = location.pathname + location.search;

  function ensureStyle(){
    var existing = document.getElementById(STYLE_ID);
    if (existing) return existing;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.dataset.acreosPickerTokens = 'true';
    document.head.appendChild(s);
    return s;
  }

  function applyTokens(tokens){
    var s = ensureStyle();
    var lines = [':root, html, body, .dark, [data-theme="dark"] {'];
    for (var name in tokens){
      if (!/^--[a-z0-9-]+$/i.test(name)) continue;
      var value = String(tokens[name]).replace(/[^#a-zA-Z0-9.,()% \-_/]/g, '');
      lines.push('  ' + name + ': ' + value + ' !important;');
    }
    lines.push('}');
    s.textContent = lines.join('\n');
  }

  function clearTokens(){
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  window.addEventListener('message', function(e){
    if (!e.data || typeof e.data !== 'object') return;
    var t = e.data.type;
    if (t === 'acreos:tokens-apply') applyTokens(e.data.tokens || {});
    else if (t === 'acreos:tokens-clear') clearTokens();
  });

  try {
    window.parent.postMessage({
      type: 'acreos:tokens-injected', surfacePath: surfacePath
    }, '*');
  } catch (err) {}
})();
