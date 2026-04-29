// AcreOS picker — copy-edit injector. REMOVE_BEFORE_LAUNCH (Gap 1.1.G).
// Injected into the production iframe (same-origin) so the founder can
// click any visible text and edit it inline. Each editable element gets a
// stable data-copy-id (surfacePath::djb2Hash(originalText)). Edits are
// posted to the picker via window.parent.postMessage and stored in
// selection.copyOverrides; 1.1.F applies the overrides to source.

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

  var TEXT_TAGS = {
    H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,P:1,SPAN:1,BUTTON:1,A:1,LABEL:1,
    LI:1,TD:1,TH:1,DT:1,DD:1,BLOCKQUOTE:1,EM:1,STRONG:1,SMALL:1,
    FIGCAPTION:1,SUMMARY:1,CAPTION:1,LEGEND:1,DIV:1,B:1,I:1,U:1,MARK:1
  };
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
        if (n.classList.contains('cl-rootBox')) return true;
        if (n.classList.contains('cl-userButton-root')) return true;
        if (n.classList.contains('cl-modal')) return true;
        if (n.classList.contains('cookie-consent') || n.classList.contains('cookie-banner')) return true;
      }
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
    var hasText = false, hasBlockChild = false;
    for (var i = 0; i < el.childNodes.length; i++){
      var c = el.childNodes[i];
      if (c.nodeType === 3){
        if (c.nodeValue && c.nodeValue.trim().length > 0) hasText = true;
      } else if (c.nodeType === 1){
        if (!TEXT_TAGS[c.tagName]) hasBlockChild = true;
      }
    }
    if (!hasText) return false;
    if (hasBlockChild) return false;
    if (el.textContent.trim().length < 1) return false;
    return true;
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
    } catch (err) {}
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
      observer = new MutationObserver(function(){
        if (!active) return;
        scheduleReapply();
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
