// Source for the script injected into the preview iframe to enable
// click-to-edit copy mode. Same-origin so we can attach it directly
// via `iframe.contentDocument.createElement('script')`.
//
// Communicates with the picker (parent) via postMessage:
//   ← acreos:copy-edit-injected   { surfacePath }                          (script ready)
//   ← acreos:copy-edit-ready      { surfacePath, count }                   (markers applied)
//   ← acreos:copy-edit            { id, original, edited, surfacePath }    (text changed)
//   → acreos:copy-edit-activate   {}                                       (turn on edit mode)
//   → acreos:copy-edit-deactivate {}                                       (turn off edit mode)
//   → acreos:copy-edit-apply      { overrides: Record<copyId,string> }     (re-apply saved edits)

export const COPY_EDIT_INJECTOR_SOURCE = String.raw`
(function(){
  if (window.__acreosCopyEditInjected) return;
  window.__acreosCopyEditInjected = true;

  var surfacePath = location.pathname + location.search;
  var active = false;
  var pendingOverrides = {};
  var observer = null;
  var debounceTimer = null;

  function hash(s){
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Tags that typically host editable copy. DIV is allowed only when it
  // contains *just* text (no element children) — most copy lives in span/p/h*.
  var TEXT_TAGS = {
    H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,P:1,SPAN:1,BUTTON:1,A:1,LABEL:1,
    LI:1,TD:1,TH:1,DT:1,DD:1,BLOCKQUOTE:1,EM:1,STRONG:1,SMALL:1,
    FIGCAPTION:1,SUMMARY:1,CAPTION:1,LEGEND:1,DIV:1,B:1,I:1,U:1,MARK:1
  };

  // Skip anything inside these (form fields, embedded UIs, code).
  var SKIP_TAG_ANCESTOR = {
    SCRIPT:1,STYLE:1,INPUT:1,TEXTAREA:1,SELECT:1,IFRAME:1,
    NOSCRIPT:1,CODE:1,PRE:1,SVG:1
  };

  function ancestorBlocked(el){
    var n = el;
    while (n && n !== document.body && n !== document.documentElement){
      var t = n.tagName;
      if (t && SKIP_TAG_ANCESTOR[t]) return true;
      if (n.classList){
        // Clerk hosted widgets
        if (n.classList.contains('cl-rootBox')) return true;
        if (n.classList.contains('cl-userButton-root')) return true;
        if (n.classList.contains('cl-modal')) return true;
        // Cookie banner — not in scope for founder copy decisions
        if (n.classList.contains('cookie-consent') || n.classList.contains('cookie-banner')) return true;
      }
      // Already inside another editable
      if (n.dataset && n.dataset.copyId) return true;
      n = n.parentElement;
    }
    return false;
  }

  function eligible(el){
    if (!el || !el.tagName) return false;
    if (!TEXT_TAGS[el.tagName]) return false;
    if (el.dataset.copyId) return false;
    if (el.contentEditable === 'true') return false;
    if (ancestorBlocked(el)) return false;
    // Must contain a non-empty direct text node.
    var hasText = false;
    var hasBlockChild = false;
    for (var i = 0; i < el.childNodes.length; i++){
      var c = el.childNodes[i];
      if (c.nodeType === 3){
        if (c.nodeValue && c.nodeValue.trim().length > 0) hasText = true;
      } else if (c.nodeType === 1){
        // Has element children — only allow if all children are inline text tags
        // (we still want to edit "<p>foo <strong>bar</strong></p>" at the <p> level).
        if (!TEXT_TAGS[c.tagName]) hasBlockChild = true;
      }
    }
    if (!hasText) return false;
    if (hasBlockChild) return false;
    // Skip super-short or numeric-only (icons, status dots, badges)
    var t = el.textContent.trim();
    if (t.length < 1) return false;
    return true;
  }

  function suppressMutationsFor(el){
    // Mark element so our own observer ignores its mutations
    el.__acreosOwn = true;
  }

  function applyMarkers(){
    var all = document.body.querySelectorAll('*');
    var added = 0;
    for (var i = 0; i < all.length; i++){
      var el = all[i];
      if (!eligible(el)) continue;
      var text = el.textContent.trim();
      var id = surfacePath + '::' + hash(text);
      el.dataset.copyId = id;
      el.dataset.copyOriginal = text;
      el.contentEditable = 'true';
      el.setAttribute('spellcheck', 'false');
      el.style.outline = '1px dashed transparent';
      el.style.outlineOffset = '2px';
      el.style.cursor = 'text';
      el.addEventListener('mouseenter', onHoverIn);
      el.addEventListener('mouseleave', onHoverOut);
      el.addEventListener('input', onInput);
      el.addEventListener('focus', onFocusIn);
      el.addEventListener('blur', onFocusOut);
      // Re-apply any pending override
      if (pendingOverrides[id] != null && pendingOverrides[id] !== text){
        el.textContent = pendingOverrides[id];
      }
      added++;
    }
    return added;
  }

  function removeMarkers(){
    var all = document.body.querySelectorAll('[data-copy-id]');
    for (var i = 0; i < all.length; i++){
      var el = all[i];
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
      delete el.dataset.copyId;
      delete el.dataset.copyOriginal;
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.cursor = '';
      el.removeEventListener('mouseenter', onHoverIn);
      el.removeEventListener('mouseleave', onHoverOut);
      el.removeEventListener('input', onInput);
      el.removeEventListener('focus', onFocusIn);
      el.removeEventListener('blur', onFocusOut);
    }
  }

  function onHoverIn(e){ if (active) e.currentTarget.style.outlineColor = 'rgba(217,119,87,0.55)'; }
  function onHoverOut(e){ e.currentTarget.style.outlineColor = 'transparent'; }
  function onFocusIn(e){
    var el = e.currentTarget;
    el.style.outlineColor = 'rgba(217,119,87,1)';
    el.style.outlineStyle = 'solid';
  }
  function onFocusOut(e){
    var el = e.currentTarget;
    el.style.outlineColor = 'transparent';
    el.style.outlineStyle = 'dashed';
  }
  function onInput(e){
    var el = e.currentTarget;
    var id = el.dataset.copyId;
    var original = el.dataset.copyOriginal;
    var edited = el.textContent;
    pendingOverrides[id] = edited;
    try {
      window.parent.postMessage({
        type: 'acreos:copy-edit',
        id: id, original: original, edited: edited, surfacePath: surfacePath
      }, '*');
    } catch (err) { /* parent gone */ }
  }

  function scheduleReapply(){
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function(){
      if (!active) return;
      var added = applyMarkers();
      try {
        window.parent.postMessage({
          type: 'acreos:copy-edit-ready',
          surfacePath: surfacePath, count: added
        }, '*');
      } catch (err) {}
    }, 250);
  }

  function activate(){
    active = true;
    var added = applyMarkers();
    if (!observer){
      observer = new MutationObserver(function(mutations){
        if (!active) return;
        // Ignore if all mutations are our own
        for (var i = 0; i < mutations.length; i++){
          var m = mutations[i];
          if (m.target && m.target.__acreosOwn) continue;
          scheduleReapply();
          break;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    try {
      window.parent.postMessage({
        type: 'acreos:copy-edit-ready',
        surfacePath: surfacePath, count: added
      }, '*');
    } catch (err) {}
  }

  function deactivate(){
    active = false;
    if (observer){ observer.disconnect(); observer = null; }
    removeMarkers();
  }

  window.addEventListener('message', function(e){
    if (!e.data || typeof e.data !== 'object') return;
    var t = e.data.type;
    if (t === 'acreos:copy-edit-activate') activate();
    else if (t === 'acreos:copy-edit-deactivate') deactivate();
    else if (t === 'acreos:copy-edit-apply'){
      var ov = e.data.overrides || {};
      for (var id in ov) pendingOverrides[id] = ov[id];
      if (active){
        for (var id2 in ov){
          var el = document.querySelector('[data-copy-id="' + id2.replace(/"/g, '\\"') + '"]');
          if (el && el.textContent !== ov[id2]) el.textContent = ov[id2];
        }
      }
    }
  });

  try {
    window.parent.postMessage({
      type: 'acreos:copy-edit-injected', surfacePath: surfacePath
    }, '*');
  } catch (err) {}
})();
`;
