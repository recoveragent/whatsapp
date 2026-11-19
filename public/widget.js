/*
 * Website chat widget. Embedded on merchants' sites with:
 *   <script src="https://<app>/widget.js" data-key="wgt_..." async></script>
 *
 * Plain JavaScript with no dependencies, because it runs on other people's
 * pages. Rendered in a Shadow DOM so the site's CSS and ours can't collide.
 * All server text goes through text nodes, never innerHTML.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (window.__chatWidgetLoaded || !script) return;
  window.__chatWidgetLoaded = true;

  var key = script.getAttribute('data-key');
  if (!key) {
    console.warn('[chat widget] Missing data-key attribute.');
    return;
  }

  var apiBase = new URL(script.src).origin;
  var storageKey = 'chat-widget:' + key;
  var sessionKey = loadSessionKey();
  var MAX_INPUT = 1000;
  var MAX_TURNS = 20;
  var MAX_SENT_REPLY = 4000;

  var ERROR_TEXT = {
    slow_down: 'You’re sending messages quickly. Please wait a moment and try again.',
    busy: 'We’re getting a lot of chats right now. Please try again shortly.',
  };
  var DEFAULT_ERROR = 'Sorry, something went wrong. Please try again.';

  var config = null;
  var items = loadItems();
  var sending = false;
  // The newest AI reply types itself out once; any other render shows it whole.
  var typingItem = null;
  var typingStarted = false;
  var typingFrame = 0;
  var justTyped = null;
  var sessionVersion = 0;
  var refs = {};
  var historyMarker = '__chatWidgetOpen';
  var greetingTimer;
  var greetingHideTimer;
  var greetingCancelled = false;
  var lastCheckedUrl = null;

  // page-rules:start — mirrors src/lib/website-widget/page-rules.ts; the test
  // there runs the same cases against this copy.
  function pageRuleMatches(rule, href) {
    var url;
    try { url = new URL(href, 'https://example.invalid'); } catch { return false; }
    var path = url.pathname.toLowerCase();
    if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
    var value = String(rule.value || '');
    var target = rule.type === 'regex' || value.indexOf('?') !== -1 ? path + url.search.toLowerCase() : path;
    switch (rule.type) {
      case 'contains': return target.indexOf(value) !== -1;
      case 'exact': return target === value;
      case 'starts_with': return target.indexOf(value) === 0;
      case 'pattern':
        return new RegExp('^' + value.split('*').map(function (part) {
          return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        }).join('.*') + '$').test(target);
      case 'regex':
        try { return new RegExp(value, 'i').test(target); } catch { return false; }
      default: return false;
    }
  }

  function pageRulesAllow(rules, href) {
    if (!rules || typeof rules !== 'object') return true;
    var matches = function (rule) { return rule && pageRuleMatches(rule, href); };
    if (Array.isArray(rules.exclude) && rules.exclude.some(matches)) return false;
    if (rules.show !== 'only') return true;
    return Array.isArray(rules.include) && rules.include.some(matches);
  }
  // page-rules:end

  /**
   * Show or hide the whole widget for the current page. An open chat is never
   * cut off: it stays until the visitor closes it, then this runs again.
   */
  function applyPageRules() {
    if (!refs.host) return;
    lastCheckedUrl = window.location.href;
    var allowed = pageRulesAllow(config.page_rules, lastCheckedUrl);
    if (!allowed && refs.panel.classList.contains('open')) return;
    refs.host.style.setProperty('display', allowed ? 'block' : 'none', 'important');
    if (!allowed) {
      clearTimeout(greetingTimer);
      clearTimeout(greetingHideTimer);
      refs.launcherGreeting.hidden = true;
    }
  }

  /** Single-page storefronts change the URL without reloading this script. */
  function watchNavigation() {
    var check = function () {
      // Defer so the new URL is in place, and skip our own history entries.
      setTimeout(function () {
        if (window.location.href !== lastCheckedUrl) applyPageRules();
      }, 0);
    };
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = window.history[name];
      if (typeof original !== 'function') return;
      window.history[name] = function () {
        var result = original.apply(this, arguments);
        check();
        return result;
      };
    });
    window.addEventListener('popstate', check);
  }

  function loadSessionKey(forceNew) {
    var storageName = storageKey + ':session';
    try {
      var existing = sessionStorage.getItem(storageName);
      if (!forceNew && existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
    } catch { /* Continue with an in-memory session. */ }
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var value = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    try { sessionStorage.setItem(storageName, value); } catch { /* In-memory only. */ }
    return value;
  }

  function loadItems() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved.filter(function (item, index) {
        return !item.phonePrompt || item.saved || (index > 0 && saved[index - 1].handoff);
      }) : [];
    } catch {
      return [];
    }
  }

  function saveItems() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      /* Blocked or full storage only costs the visitor their history. */
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function httpsUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function externalLink(href, className, text) {
    var link = el('a', className, text);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  /** Readable text colour for the merchant's accent. */
  function contrastColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#ffffff';
    var channels = [1, 3, 5].map(function (i) {
      var value = parseInt(hex.slice(i, i + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    var luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return (luminance + 0.05) / 0.0556 >= 1.05 / (luminance + 0.05) ? '#111111' : '#ffffff';
  }

  /** Append text, turning https links into anchors and nothing else. */
  function appendLinkified(parent, text) {
    var pattern = /https:\/\/[^\s<>"]+/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      var url = match[0].replace(/[.,;:!?)\]]+$/, '');
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      var safe = httpsUrl(url);
      parent.appendChild(
        safe
          ? externalLink(safe, 'inline-link', url)
          : document.createTextNode(url)
      );
      last = match.index + url.length;
    }
    parent.appendChild(document.createTextNode(text.slice(last)));
  }

  /**
   * Append message text, rendering **bold** / *bold* as <strong> and
   * linkifying https URLs. Built from text nodes only — no innerHTML.
   */
  function appendFormatted(parent, text) {
    var pattern = /\*\*([^*\n]+?)\*\*|\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      appendLinkified(parent, text.slice(last, match.index));
      var strong = el('strong');
      appendLinkified(strong, match[1] != null ? match[1] : match[2]);
      parent.appendChild(strong);
      last = match.index + match[0].length;
    }
    appendLinkified(parent, text.slice(last));
  }

  function renderProduct(product) {
    var href = httpsUrl(product.url);
    if (!href) return null;
    var card = externalLink(href, 'product');
    var image = httpsUrl(product.image_url);
    if (image) {
      var img = el('img', 'product-image');
      img.src = image;
      img.alt = '';
      img.loading = 'lazy';
      card.appendChild(img);
    }
    var body = el('span', 'product-body');
    body.appendChild(el('span', 'product-title', product.title));
    if (product.variant_title) {
      body.appendChild(el('span', 'product-variant', product.variant_title));
    }
    body.appendChild(el('span', 'product-price', product.price));
    body.appendChild(el('span', 'product-cta', 'View product'));
    card.appendChild(body);
    return card;
  }

  function renderItem(item, isLatest) {
    var row = el('div', 'row ' + (item.role === 'user' ? 'row-user' : 'row-bot'));
    var bubble = el('div', 'bubble');
    appendFormatted(bubble, item.content);
    row.appendChild(bubble);
    if (item === typingItem) {
      // Extras (products, buttons) wait until the text has finished typing.
      bubble.classList.add('typing-out');
      bubble.setAttribute('aria-hidden', 'true');
      row.appendChild(el('span', 'sr-only', item.content));
      return row;
    }
    if (item === justTyped) row.classList.add('just-typed');

    if (item.phonePrompt && !item.saved) {
      var phoneForm = el('form', 'phone-form');
      var country = el('input', 'country-input');
      country.type = 'tel';
      country.value = '+91';
      country.required = true;
      country.pattern = '\\+[1-9][0-9]{0,2}';
      country.setAttribute('aria-label', 'Country calling code');
      var phone = el('input', 'phone-input');
      phone.type = 'tel';
      phone.inputMode = 'numeric';
      phone.placeholder = '10-digit mobile number';
      phone.setAttribute('aria-label', '10-digit mobile number');
      phone.pattern = '[0-9]{10}';
      phone.maxLength = 10;
      phone.required = true;
      var submitPhone = el('button', 'choice', 'Share number');
      submitPhone.type = 'submit';
      var phoneError = el('span', 'phone-error');
      phoneError.setAttribute('role', 'alert');
      phoneForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!phoneForm.reportValidity()) return;
        submitPhone.disabled = true;
        var requestVersion = sessionVersion;
        phoneError.textContent = '';
        fetch(apiBase + '/api/widget/phone?key=' + encodeURIComponent(key), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
          body: JSON.stringify({ session_key: sessionKey, country_code: country.value, phone: phone.value }),
        }).then(function (response) {
          if (!response.ok) throw new Error('Unable to save');
          if (requestVersion !== sessionVersion) return;
          item.saved = true;
          item.content = 'Thanks! Our team can use your number to follow up on WhatsApp.';
          saveItems();
          render();
        }).catch(function () {
          if (requestVersion !== sessionVersion) return;
          phoneError.textContent = 'Could not save your number. Please try again.';
          submitPhone.disabled = false;
        });
      });
      phoneForm.appendChild(country);
      phoneForm.appendChild(phone);
      phoneForm.appendChild(submitPhone);
      phoneForm.appendChild(phoneError);
      row.appendChild(phoneForm);
    }

    var cards = (item.products || []).map(renderProduct).filter(Boolean);
    if (cards.length) {
      row.classList.add('has-products');
      var productSection = el('div', 'product-section');
      var productList = el('div', 'product-list');
      productList.setAttribute('role', 'region');
      productList.setAttribute('aria-label', 'Recommended products');
      productList.setAttribute('tabindex', '0');
      cards.forEach(function (card) { productList.appendChild(card); });
      productSection.appendChild(productList);
      if (cards.length > 1) {
        var productNav = el('div', 'product-nav');
        [['Previous products', '‹', -1], ['Next products', '›', 1]].forEach(function (control) {
          var button = el('button', 'product-nav-button', control[1]);
          button.type = 'button';
          button.setAttribute('aria-label', control[0]);
          button.addEventListener('click', function () {
            productList.scrollBy({ left: control[2] * 200, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          });
          productNav.appendChild(button);
        });
        productSection.appendChild(productNav);
      }
      row.appendChild(productSection);
    }

    var whatsapp = item.whatsappUrl && httpsUrl(item.whatsappUrl);
    if (whatsapp) {
      if (item.handoff) {
        row.appendChild(el('span', 'handoff-disclosure', 'Continuing shares this website conversation with our team on WhatsApp.'));
        var handoffButton = el('button', 'whatsapp-cta', 'Continue on WhatsApp');
        handoffButton.type = 'button';
        handoffButton.addEventListener('click', function () { startHandoff(handoffButton); });
        row.appendChild(handoffButton);
      } else {
        row.appendChild(externalLink(whatsapp, 'whatsapp-cta', 'Continue on WhatsApp'));
      }
    }

    if (isLatest && item.quickReplies && item.quickReplies.length) {
      var choices = el('div', 'choices');
      item.quickReplies.forEach(function (label) {
        var choice = el('button', 'choice', label);
        choice.type = 'button';
        choice.addEventListener('click', function () {
          send(label);
        });
        choices.appendChild(choice);
      });
      row.appendChild(choices);
    }
    return row;
  }

  /** Reveal a rendered bubble's text over time, keeping its bold and links. */
  function typeOut(bubble) {
    var nodes = [];
    var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    var total = 0;
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, text: walker.currentNode.data });
      total += walker.currentNode.data.length;
      walker.currentNode.data = '';
    }
    var caret = el('span', 'type-caret');
    bubble.appendChild(caret);
    // ~70 chars/s, but never longer than 2.5s however long the reply is.
    var speed = Math.max(0.07, total / 2500);
    var start = null;
    function finish() {
      typingFrame = 0;
      justTyped = typingItem;
      typingItem = null;
      render();
      justTyped = null;
    }
    function step() {
      var now = Date.now();
      if (start === null) start = now;
      var shown = Math.min(total, Math.floor((now - start) * speed));
      var left = shown;
      for (var i = 0; i < nodes.length; i++) {
        var part = Math.min(left, nodes[i].text.length);
        nodes[i].node.data = nodes[i].text.slice(0, part);
        left -= part;
        if (part < nodes[i].text.length) {
          nodes[i].node.parentNode.insertBefore(caret, nodes[i].node.nextSibling);
          break;
        }
      }
      refs.log.scrollTop = refs.log.scrollHeight;
      if (shown >= total) return finish();
      typingFrame = setTimeout(step, 30);
    }
    typingFrame = setTimeout(step, 0);
  }

  function render() {
    var log = refs.log;
    if (typingFrame) {
      clearTimeout(typingFrame);
      typingFrame = 0;
    }
    // Something else re-rendered mid-typing: show the reply whole.
    if (typingItem && typingStarted) typingItem = null;
    log.textContent = '';
    log.appendChild(renderItem({ role: 'assistant', content: config.greeting || 'Hi! 👋 How can we help you today?' }, false));
    if (!sending && Array.isArray(config.suggested_questions) && config.suggested_questions.length && items.every(function (item) { return item.nameEntry || item.isError; })) {
      var starters = el('div', 'starters');
      starters.appendChild(el('div', 'starters-label', 'Not sure where to start?'));
      config.suggested_questions.slice(0, 5).forEach(function (label) {
        var starter = el('button', 'starter', label + '  \u2197');
        starter.type = 'button';
        starter.addEventListener('click', function () { send(label); });
        starters.appendChild(starter);
      });
      log.appendChild(starters);
    }
    var typingIndex = typingItem ? items.indexOf(typingItem) : -1;
    items.forEach(function (item, index) {
      if (typingIndex !== -1 && index > typingIndex) return;
      log.appendChild(renderItem(item, !sending && (index === items.length - 1 || (index === items.length - 2 && items[index + 1].phonePrompt))));
    });
    if (typingIndex !== -1) {
      typingStarted = true;
      typeOut(log.querySelector('.typing-out'));
    } else typingItem = null;
    if (sending) {
      var typing = el('div', 'row row-bot');
      var dots = el('div', 'bubble typing');
      dots.setAttribute('aria-label', 'Typing');
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      dots.appendChild(el('span'));
      typing.appendChild(dots);
      log.appendChild(typing);
    }
    log.scrollTop = log.scrollHeight;
    refs.send.disabled = sending;
    refs.input.disabled = false;
    refs.input.placeholder = 'Ask me anything...';
  }

  /** The transcript the server needs. Display-only fields stay in the browser. */
  function transcript() {
    var turns = items
      .filter(function (item) {
        return !item.isError && !item.phonePrompt;
      });
    if (turns.length > MAX_TURNS && turns[0].nameEntry && turns[1] && turns[1].nameEntry) {
      turns = turns.slice(0, 2).concat(turns.slice(-(MAX_TURNS - 2)));
    } else {
      turns = turns.slice(-MAX_TURNS);
    }
    return turns
      .map(function (item) {
        var turn = {
          role: item.role,
          content: item.content.slice(0, MAX_SENT_REPLY),
        };
        if (item.products && item.products.length) {
          turn.productVariantIds = item.products.map(function (product) {
            return product.variant_id;
          });
        }
        return turn;
      });
  }

  function startHandoff(button) {
    var turns = transcript();
    while (turns.length && turns[turns.length - 1].role !== 'user') turns.pop();
    if (!turns.length) return;
    var popup = window.open('', '_blank');
    if (!popup) {
      button.textContent = 'Allow pop-ups to continue';
      return;
    }
    popup.opener = null;
    var requestVersion = sessionVersion;
    button.disabled = true;
    fetch(apiBase + '/api/widget/handoff?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ messages: turns }),
    }).then(function (response) {
      if (!response.ok) throw new Error('Handoff unavailable');
      return response.json();
    }).then(function (body) {
      if (requestVersion !== sessionVersion) { popup.close(); return; }
      var url = httpsUrl(body.url);
      if (!url || new URL(url).hostname !== 'wa.me') throw new Error('Invalid handoff');
      popup.location.href = url;
      button.textContent = 'Continue on WhatsApp';
    }).catch(function () {
      popup.close();
      button.textContent = 'Could not connect. Try again';
    }).then(function () { button.disabled = false; });
  }

  // Only send the product handle, never a URL or its query string.
  function currentProductHandle() {
    var match = window.location.pathname.match(/(?:^|\/)products\/([a-z0-9][a-z0-9-]{0,254})\/?$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function currentVariantId() {
    if (!currentProductHandle()) return null;
    var form = document.querySelector('form[action*="/cart/add"]');
    var field = form && form.querySelector('[name="id"]');
    var id = (field && field.value) || new URLSearchParams(window.location.search).get('variant');
    return id && /^[1-9][0-9]{0,19}$/.test(id) ? id : null;
  }

  function send(raw) {
    var text = String(raw || '').trim().slice(0, MAX_INPUT);
    if (!text || sending) return;
    if (!items.some(function (item) { return !item.isError; })) items = [];
    items.push({ role: 'user', content: text });
    sending = true;
    var requestVersion = sessionVersion;
    saveItems();
    render();

    fetch(apiBase + '/api/widget/chat?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ messages: transcript(), session_key: sessionKey, product_handle: currentProductHandle(), variant_id: currentVariantId() }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (requestVersion !== sessionVersion) return;
        var body = result.body || {};
        if (!result.ok || typeof body.reply !== 'string') {
          items.push({
            role: 'assistant',
            isError: true,
            content: ERROR_TEXT[body.code] || DEFAULT_ERROR,
            whatsappUrl: body.whatsapp_url || null,
          });
          return;
        }
        var reply = {
          role: 'assistant',
          content: body.reply,
          products: body.products || [],
          quickReplies: body.quick_replies || [],
          whatsappUrl: body.handoff ? body.whatsapp_url : null,
          handoff: Boolean(body.handoff),
        };
        items.push(reply);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          typingItem = reply;
          typingStarted = false;
        }
        if (body.handoff && !items.some(function (item) { return item.phonePrompt; })) {
          items.push({ role: 'assistant', phonePrompt: true, content: 'For a WhatsApp follow-up, you can share your mobile number.' });
        }
      })
      .catch(function () {
        if (requestVersion !== sessionVersion) return;
        items.push({ role: 'assistant', isError: true, content: DEFAULT_ERROR });
      })
      .then(function () {
        if (requestVersion !== sessionVersion) return;
        sending = false;
        saveItems();
        render();
        if (refs.panel.classList.contains('open') && !window.matchMedia('(max-width:480px)').matches) refs.input.focus();
      });
  }

  function resetChat() {
    sessionVersion++;
    typingItem = null;
    sessionKey = loadSessionKey(true);
    items = [];
    sending = false;
    refs.input.value = '';
    saveItems();
    render();
    refs.input.focus();
  }

  function setExpanded(expanded) {
    refs.panel.classList.toggle('expanded', expanded);
    refs.panel.style.removeProperty('--drag-height');
    refs.expand.setAttribute('aria-label', expanded ? 'Collapse chat' : 'Expand chat');
    refs.expand.setAttribute('aria-expanded', String(expanded));
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function setOpen(open, fromHistory) {
    var wasOpen = refs.panel.classList.contains('open');
    if (open === wasOpen) return;
    if (!fromHistory) {
      if (open) {
        try {
          var state = window.history.state;
          var chatState = state && typeof state === 'object' ? Object.assign({}, state) : {};
          chatState[historyMarker] = true;
          window.history.pushState(chatState, '', window.location.href);
        } catch { /* Chat remains usable if the browser blocks history changes. */ }
      } else if (window.history.state && window.history.state[historyMarker]) {
        window.history.back();
      }
    }
    refs.panel.classList.toggle('open', open);
    refs.backdrop.classList.toggle('open', open);
    refs.launcher.classList.toggle('hidden', open);
    if (open) {
      greetingCancelled = true;
      clearTimeout(greetingTimer);
      clearTimeout(greetingHideTimer);
      refs.launcherGreeting.hidden = true;
    }
    refs.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      setExpanded(false);
      refs.log.scrollTop = refs.log.scrollHeight;
      if (window.matchMedia('(max-width:480px)').matches) refs.close.focus({ preventScroll: true });
      else refs.input.focus();
    } else {
      applyPageRules();
      if (refs.host.style.display !== 'none') refs.launcher.focus();
    }
  }

  window.addEventListener('popstate', function () {
    if (refs.panel && refs.panel.classList.contains('open')) setOpen(false, true);
  });

  function icon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
  }

  // Outlined bubble with typing dots: reads as "chat" at any accent colour.
  function launcherIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'launcher-icon');
    var bubble = document.createElementNS(ns, 'path');
    bubble.setAttribute('d', 'M12 3.75c-4.83 0-8.75 3.36-8.75 7.5 0 2.13 1.04 4.05 2.71 5.42-.2 1.33-.82 2.5-1.71 3.43 1.86.1 3.55-.5 4.86-1.44.92.24 1.89.36 2.89.36 4.83 0 8.75-3.36 8.75-7.5S16.83 3.75 12 3.75z');
    svg.appendChild(bubble);
    [8, 12, 16].forEach(function (cx, i) {
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', '11.25');
      dot.setAttribute('r', '1.25');
      dot.setAttribute('class', 'launcher-dot launcher-dot-' + i);
      svg.appendChild(dot);
    });
    return svg;
  }

  /** White glyph unless the accent is genuinely light; a glossy bubble wants white. */
  function launcherContrast(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#ffffff';
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 190 ? '#111111' : '#ffffff';
  }

  function mount() {
    // Not a div: everything lives in the shadow root, so the host matches
    // :empty, and Shopify themes commonly ship `div:empty { display: none }`.
    var host = el('chat-widget-host');
    host.id = 'chat-widget-root';
    host.style.setProperty('display', 'block', 'important');
    var shadow = host.attachShadow({ mode: 'open' });

    var style = el('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var root = el('div', 'root desktop-' + (config.desktop_position === 'left' ? 'left' : 'right') + ' mobile-' + (config.mobile_position === 'left' ? 'left' : 'right'));
    function offset(value, fallback) {
      return Number.isInteger(value) && value >= 0 && value <= 200 ? value + 'px' : fallback + 'px';
    }
    root.style.setProperty('--desktop-side', offset(config.desktop_side_offset, 20));
    root.style.setProperty('--desktop-bottom', offset(config.desktop_bottom_offset, 20));
    root.style.setProperty('--mobile-side', offset(config.mobile_side_offset, 16));
    root.style.setProperty('--mobile-bottom', offset(config.mobile_bottom_offset, 16));
    root.style.setProperty('--chat-primary', config.accent_color);
    root.style.setProperty('--chat-primary-contrast', launcherContrast(config.accent_color));
    root.style.setProperty('--accent', config.accent_color);
    root.style.setProperty('--on-accent', contrastColor(config.accent_color));

    var launcher = el('button', 'launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.appendChild(launcherIcon());
    var indicator = el('span', 'launcher-indicator', config.launcher_indicator === 'number' ? '1' : '');
    indicator.setAttribute('aria-hidden', 'true');
    launcher.appendChild(indicator);

    var launcherGreeting = el('button', 'launcher-greeting');
    launcherGreeting.type = 'button';
    launcherGreeting.hidden = true;
    launcherGreeting.setAttribute('aria-label', 'Open chat');
    var greetingAvatar = el('span', 'launcher-greeting-avatar', '\u2726');
    var greetingAvatarUrl = config.avatar_url && httpsUrl(config.avatar_url);
    if (greetingAvatarUrl) {
      var greetingImage = el('img');
      greetingImage.src = greetingAvatarUrl;
      greetingImage.alt = '';
      greetingImage.addEventListener('error', function () { greetingImage.remove(); });
      greetingAvatar.appendChild(greetingImage);
    }
    launcherGreeting.appendChild(greetingAvatar);
    launcherGreeting.appendChild(el('span', 'launcher-greeting-text', config.launcher_greeting_text || 'Hi! How can I help?'));
    launcherGreeting.addEventListener('click', function () { setOpen(true); });
    launcher.addEventListener('click', function () {
      setOpen(true);
    });

    var backdrop = el('div', 'backdrop');
    backdrop.addEventListener('click', function () { setOpen(false); });

    var panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', config.title);
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });

    var expand = el('button', 'sheet-handle');
    expand.type = 'button';
    expand.setAttribute('aria-label', 'Expand chat');
    expand.setAttribute('aria-expanded', 'false');
    var drag = null;
    var suppressClick = false;
    expand.addEventListener('click', function () {
      if (suppressClick) { suppressClick = false; return; }
      setExpanded(!panel.classList.contains('expanded'));
    });
    expand.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      drag = { startY: event.clientY, startHeight: panel.getBoundingClientRect().height, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0, moved: false };
      expand.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
    });
    expand.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var delta = event.clientY - drag.startY;
      if (Math.abs(delta) > 5) drag.moved = true;
      var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var height = Math.max(viewportHeight * 0.5, Math.min(viewportHeight, drag.startHeight - delta));
      panel.style.setProperty('--drag-height', height + 'px');
      var elapsed = event.timeStamp - drag.lastTime;
      if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
      drag.lastY = event.clientY;
      drag.lastTime = event.timeStamp;
    });
    function finishDrag(event) {
      if (!drag) return;
      var moved = drag.moved;
      var distance = event.clientY - drag.startY;
      var velocity = drag.velocity;
      var wasExpanded = panel.classList.contains('expanded');
      drag = null;
      panel.classList.remove('dragging');
      if (moved && event.type !== 'pointercancel') {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
        setExpanded(Math.abs(velocity) > 0.35 ? velocity < 0 : (Math.abs(distance) > 50 ? distance < 0 : wasExpanded));
      } else {
        panel.style.removeProperty('--drag-height');
      }
    }
    expand.addEventListener('pointerup', finishDrag);
    expand.addEventListener('pointercancel', finishDrag);

    function syncViewport() {
      if (!window.visualViewport) return;
      root.style.setProperty('--visible-height', window.visualViewport.height + 'px');
      root.style.setProperty('--keyboard-inset', Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop) + 'px');
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
      syncViewport();
    }

    var header = el('div', 'header');
    var identity = el('div', 'identity');
    var avatar = el('div', 'avatar', '\u2726');
    var avatarUrl = config.avatar_url && httpsUrl(config.avatar_url);
    if (avatarUrl) {
      var avatarImage = el('img', 'avatar-image');
      avatarImage.src = avatarUrl;
      avatarImage.alt = '';
      avatarImage.addEventListener('error', function () { avatarImage.remove(); });
      avatar.appendChild(avatarImage);
    }
    identity.appendChild(avatar);
    var identityText = el('div', 'identity-text');
    identityText.appendChild(el('div', 'title', config.title));
    identityText.appendChild(el('div', 'subtitle', 'Your virtual assistant'));
    identity.appendChild(identityText);
    header.appendChild(identity);
    var headerActions = el('div', 'header-actions');
    var reset = el('button', 'reset', 'Reset chat');
    reset.type = 'button';
    reset.setAttribute('aria-label', 'Reset chat');
    reset.addEventListener('click', resetChat);
    headerActions.appendChild(reset);
    var close = el('button', 'close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.appendChild(icon(CLOSE_ICON));
    close.addEventListener('click', function () {
      setOpen(false);
    });
    headerActions.appendChild(close);
    header.appendChild(headerActions);

    var log = el('div', 'log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');

    var form = el('form', 'composer');
    var input = el('textarea', 'input');
    input.rows = 1;
    input.maxLength = MAX_INPUT;
    input.placeholder = 'Ask me anything...';
    input.setAttribute('aria-label', 'Ask me anything');
    input.addEventListener('focus', function () {
      if (window.matchMedia('(max-width:480px)').matches) setExpanded(true);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    var submit = el('button', 'send');
    submit.type = 'submit';
    submit.setAttribute('aria-label', 'Send message');
    submit.appendChild(icon(SEND_ICON));
    form.appendChild(input);
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (sending) return;
      var value = input.value;
      input.value = '';
      send(value);
    });

    panel.appendChild(expand);
    panel.appendChild(header);
    panel.appendChild(log);
    var whatsapp = config.whatsapp_url && httpsUrl(config.whatsapp_url);
    if (whatsapp && config.show_whatsapp_link !== false) {
      panel.appendChild(externalLink(whatsapp, 'footer-link', 'Prefer WhatsApp? Chat with us there'));
    }
    panel.appendChild(form);

    root.appendChild(backdrop);
    root.appendChild(panel);
    root.appendChild(launcher);
    root.appendChild(launcherGreeting);
    shadow.appendChild(root);
    document.body.appendChild(host);

    refs = { host: host, panel: panel, backdrop: backdrop, launcher: launcher, launcherGreeting: launcherGreeting, close: close, expand: expand, log: log, input: input, send: submit };
    render();
    applyPageRules();
    watchNavigation();
    if (config.launcher_greeting_enabled) {
      var scheduleGreeting = function () {
        if (greetingCancelled) return;
        var delay = Math.max(0, Math.min(300, Number(config.launcher_greeting_delay) || 0)) * 1000;
        var navigation = window.performance && window.performance.getEntriesByType && window.performance.getEntriesByType('navigation')[0];
        var elapsed = navigation && navigation.loadEventEnd ? Math.max(0, window.performance.now() - navigation.loadEventEnd) : 0;
        if (elapsed >= delay + 5000) return;
        greetingTimer = setTimeout(function () {
          if (greetingCancelled || host.style.display === 'none') return;
          launcherGreeting.hidden = false;
          greetingHideTimer = setTimeout(function () { launcherGreeting.hidden = true; }, 5000);
        }, Math.max(0, delay - elapsed));
      };
      if (document.readyState === 'complete') scheduleGreeting();
      else window.addEventListener('load', scheduleGreeting, { once: true });
    }
  }

  var CHAT_ICON =
    'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 1-2z';
  var CLOSE_ICON =
    'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z';
  var SEND_ICON = 'M3 20.5v-6.2l12-2.3-12-2.3V3.5L22 12z';

  var CSS = [
    ':host{all:initial;--chat-background:#f7f8f7;--chat-surface:#fff;--chat-text:#1f2328;--chat-text-muted:#5b6470;--chat-border:#e3e9e6;--chat-radius:24px}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.root{position:fixed;right:var(--desktop-side);bottom:var(--desktop-bottom);z-index:2147483000;color:var(--chat-text);font-size:14px;line-height:1.45}',
    '@media (min-width:481px){.root.desktop-left{left:var(--desktop-side);right:auto}}',
    'svg{width:24px;height:24px;fill:currentColor;display:block}',
    'button{cursor:pointer;font:inherit}',
    'a:focus-visible,button:focus-visible,textarea:focus-visible,.product-list:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.launcher{width:56px;height:56px;border:0;border-radius:50%;background:var(--chat-primary);color:var(--chat-primary-contrast);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)}',
    '.launcher.hidden{display:none}',
    '.launcher{position:relative}',
    '.launcher-indicator{position:absolute;right:-2px;top:-2px;display:grid;place-items:center;width:19px;height:19px;border:3px solid white;border-radius:50%;background:#25c83b;color:#fff;font-size:10px;font-weight:700;line-height:1}',
    '.launcher-greeting{position:absolute;right:0;bottom:76px;display:flex;align-items:center;gap:12px;width:max-content;max-width:min(330px,calc(100vw - 32px));min-height:62px;padding:9px 16px 9px 8px;border:0;border-radius:38px;background:#fff9fa;color:#171927;text-align:left;box-shadow:0 10px 30px rgba(74,31,53,.2)}',
    '.launcher-greeting[hidden]{display:none}',
    '.launcher-greeting:after{content:"";position:absolute;right:19px;bottom:-9px;border-width:10px 0 0 16px;border-style:solid;border-color:transparent transparent transparent #fff9fa}',
    '.launcher-greeting-avatar{position:relative;display:grid;place-items:center;overflow:hidden;flex:none;width:48px;height:48px;border:3px solid white;border-radius:50%;background:#f9d8ce;color:#8d3155;font-size:22px}',
    '.launcher-greeting-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '.launcher-greeting-text{overflow-wrap:anywhere;font-size:15px;font-weight:600;line-height:1.3}',
    '@media (min-width:481px){.root.desktop-left .launcher-greeting{left:0;right:auto}.root.desktop-left .launcher-greeting:after{left:19px;right:auto;transform:scaleX(-1)}}',
    '@media (max-width:480px){.root.mobile-left .launcher-greeting{left:0;right:auto}.root.mobile-left .launcher-greeting:after{left:19px;right:auto;transform:scaleX(-1)}}',
    '.panel{display:none;flex-direction:column;width:400px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - var(--desktop-bottom) - 20px);background:var(--chat-surface);border-radius:var(--chat-radius);overflow:hidden;box-shadow:0 18px 55px rgba(24,35,42,.22)}',
    '.panel.open{display:flex}',
    '.backdrop,.sheet-handle{display:none}',
    '.header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px;background:var(--accent);color:var(--on-accent)}',
    '.identity{display:flex;align-items:center;gap:10px;min-width:0}',
    '.identity-text{min-width:0}',
    '.avatar{display:grid;place-items:center;width:42px;height:42px;flex:none;border-radius:15px;background:rgba(255,255,255,.22);font-size:24px}',
    '.avatar{position:relative;overflow:hidden}',
    '.avatar-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '.subtitle{font-size:12px;opacity:.85}',
    '.title{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.header-actions{display:flex;align-items:center;gap:4px;flex:none}',
    '.reset{border:0;border-radius:8px;background:transparent;color:inherit;padding:6px 8px;font-size:12px}',
    '.reset:hover,.close:hover{background:rgba(255,255,255,.14)}',
    '.close{width:32px;height:32px;padding:4px;border:0;border-radius:8px;background:transparent;color:inherit;flex:none}',
    '.close:focus-visible{outline-color:var(--on-accent)}',
    '.log{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 16px;background:var(--chat-background);display:flex;flex-direction:column;gap:12px}',
    '.starters{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 4px}',
    '.starters-label{width:100%;font-size:12px;color:#78837f}',
    '.starter{padding:9px 12px;border:1px solid #dce5e1;border-radius:12px;background:#fff;color:#34443f;font-size:13px;text-align:left}',
    '.starter:hover{border-color:var(--accent);color:var(--accent)}',
    '.row{display:flex;flex-direction:column;gap:6px;max-width:85%}',
    '.row-user{align-self:flex-end;align-items:flex-end}',
    '.row-bot{align-self:flex-start;align-items:flex-start}',
    '.bubble{padding:11px 14px;border-radius:16px 16px 16px 5px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #e8eeeb;box-shadow:0 2px 8px rgba(30,50,40,.03)}',
    '.row-user .bubble{background:var(--accent);color:var(--on-accent);border-color:transparent;border-radius:16px 16px 5px 16px}',
    '.inline-link{color:inherit;text-decoration:underline}',
    '.row.has-products{width:100%;max-width:100%;min-width:0}',
    '.product-section{width:100%;min-width:0}',
    '.product-list{display:flex;gap:10px;width:100%;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;padding:3px 3px 8px;scrollbar-width:thin;scrollbar-color:#bac8c0 transparent}',
    '.product{display:flex;flex-direction:column;flex:0 0 172px;width:172px;min-width:0;gap:8px;padding:8px;background:#fff;border:1px solid #e6e8eb;border-radius:12px;color:inherit;text-decoration:none;scroll-snap-align:start}',
    '.product-nav{display:flex;justify-content:flex-end;gap:6px;padding-top:3px}',
    '.product-nav-button{display:grid;place-items:center;width:30px;height:30px;border:1px solid #dce5e1;border-radius:50%;background:#fff;color:#34443f;font-size:22px;line-height:1}',
    '.product-nav-button:hover{border-color:var(--accent)}',
    '.product:hover{border-color:var(--accent)}',
    '.product-image{width:100%;height:120px;object-fit:cover;border-radius:8px;flex:none;background:#eef0f2}',
    '.product-body{display:flex;flex-direction:column;min-width:0;gap:1px}',
    '.product-title{font-weight:600;overflow-wrap:anywhere}',
    '.product-variant{color:#5b6470;font-size:13px}',
    '.product-price{font-size:13px}',
    '.product-cta{color:var(--accent);font-weight:600;font-size:13px;margin-top:2px}',
    '.whatsapp-cta{display:inline-block;padding:9px 14px;border:0;border-radius:999px;background:#128c7e;color:#fff;font-weight:600;text-decoration:none}',
    '.handoff-disclosure{font-size:12px;color:#5b6470}',
    '.choices{display:flex;flex-wrap:wrap;gap:6px}',
    '.choice{padding:7px 12px;border-radius:999px;border:1px solid var(--accent);background:#fff;color:#1f2328}',
    '.phone-form{display:flex;flex-wrap:wrap;gap:6px;width:100%}',
    '.country-input,.phone-input{min-width:0;padding:8px;border:1px solid #d5d9de;border-radius:8px;font-size:14px}',
    '.country-input{width:62px}.phone-input{flex:1;min-width:145px}',
    '.phone-error{width:100%;font-size:12px;color:#b42318}',
    '.typing{display:flex;gap:4px;padding:13px 12px}',
    '.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.type-caret{display:inline-block;width:2px;height:1em;margin-left:1px;vertical-align:-2px;border-radius:1px;background:currentColor;opacity:.55;animation:caret-blink .9s steps(1) infinite}',
    '@keyframes caret-blink{50%{opacity:0}}',
    '.just-typed>:not(.bubble){animation:reveal-up .35s ease both}',
    '@keyframes reveal-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '.typing span{width:6px;height:6px;border-radius:50%;background:#8a93a0;animation:pulse 1.2s infinite}',
    '.typing span:nth-child(2){animation-delay:.2s}',
    '.typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes pulse{0%,60%,100%{opacity:.35}30%{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.typing span{animation:none}}',
    '.footer-link{display:block;padding:7px 12px;text-align:center;font-size:12px;color:#5b6470;background:#fff;border-top:1px solid #e6e8eb;text-decoration:underline}',
    '.composer{display:flex;align-items:flex-end;gap:8px;padding:12px 14px;background:#fff;border-top:1px solid #edf0ee}',
    '.input{flex:1;min-width:0;resize:none;max-height:96px;padding:10px 12px;border:1px solid var(--chat-border);border-radius:13px;font-size:14px;line-height:1.4;color:#1f2328;background:#f8faf9}',
    '.send{width:40px;height:40px;padding:10px;border:0;border-radius:13px;background:var(--accent);color:var(--on-accent);flex:none}',
    '.send svg{width:20px;height:20px}',
    '.send:disabled{opacity:.5;cursor:default}',
    // The launcher follows merchant offsets; the open sheet follows the visual viewport.
    '@media (max-width:480px){.root{right:var(--mobile-side);bottom:var(--mobile-bottom)}.root.mobile-left{left:var(--mobile-side);right:auto}.root.mobile-right{left:auto;right:var(--mobile-side)}.backdrop.open{display:block;position:fixed;inset:0;background:rgba(17,24,39,.35)}.panel.open{position:fixed;inset:auto 0 var(--keyboard-inset,0px);width:100%;max-width:none;height:var(--drag-height,calc(var(--visible-height,100dvh) * .5));max-height:var(--visible-height,100dvh);border-radius:var(--chat-radius) var(--chat-radius) 0 0;transition:height .24s ease}.panel.open.expanded{height:var(--drag-height,var(--visible-height,100dvh));border-radius:0}.panel.dragging{transition:none}.sheet-handle{display:block;position:relative;flex:none;width:100%;height:24px;border:0;background:var(--chat-surface);touch-action:none}.sheet-handle:after{content:"";position:absolute;top:10px;left:calc(50% - 18px);width:36px;height:4px;border-radius:4px;background:#c5ccc9}.header{flex:none;padding:2px 16px 10px;background:var(--chat-surface);color:var(--chat-text)}.avatar{width:38px;height:38px;background:#e8f4ee;color:var(--accent)}.subtitle{color:var(--chat-text-muted)}.reset:hover,.close:hover{background:#f0f4f2}.close:focus-visible{outline-color:var(--accent)}.log{padding:12px 16px;background:var(--chat-surface);gap:10px}.log>.row:first-child{max-width:100%}.log>.row:first-child .bubble{padding:0;border:0;box-shadow:none;border-radius:0}.starters{flex-direction:column;flex-wrap:nowrap}.starters-label{font-weight:600;color:#34443f}.starter{width:100%}.input,.country-input,.phone-input{font-size:16px}.composer{flex:none;padding-bottom:max(10px,env(safe-area-inset-bottom))}.footer-link{flex:none}}',
    // A restrained, merchant-colour-led treatment shared by desktop and mobile.
    '.launcher{width:60px;height:60px;box-shadow:0 10px 28px rgba(20,27,36,.24);transition:transform .2s ease,box-shadow .2s ease}',
    '.launcher:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(20,27,36,.28)}',
    '.panel{width:410px;height:620px;border:1px solid rgba(20,27,36,.08);border-radius:26px;box-shadow:0 24px 70px rgba(20,27,36,.2),0 4px 16px rgba(20,27,36,.07)}',
    '.header{padding:18px 20px;background:#fff;color:#20252b;border-bottom:1px solid #eef0ef}',
    '.avatar{width:44px;height:44px;border-radius:16px;background:var(--accent);color:var(--on-accent);font-size:22px}',
    '.identity{gap:12px}.title{font-size:15px;font-weight:700;letter-spacing:-.02em}.subtitle{margin-top:2px;color:#737d7a;font-size:12px;opacity:1}',
    '.reset{color:#68736f;font-size:12px;font-weight:600}.close{color:#68736f}.reset:hover,.close:hover{background:#f2f5f3}.close:focus-visible{outline-color:var(--accent)}',
    '.log{padding:24px 20px;gap:14px;background:#f7f8f6;scrollbar-width:thin;scrollbar-color:#d9dedb transparent}',
    '.row{max-width:88%;gap:8px}.bubble{padding:13px 15px;border:1px solid #e9eeeb;border-radius:18px 18px 18px 6px;line-height:1.55;box-shadow:0 3px 12px rgba(29,43,35,.035)}',
    '.row-user .bubble{border-radius:18px 18px 6px 18px}',
    '.starters{gap:8px;margin:4px 0 6px}.starters-label{margin-bottom:2px;color:#7b8580;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
    '.starter{padding:10px 14px;border-color:#e4eae6;border-radius:14px;color:#36443d;font-weight:500;box-shadow:0 2px 8px rgba(29,43,35,.025);transition:border-color .2s ease,transform .2s ease}',
    '.starter:hover{transform:translateY(-1px)}',
    '.product{padding:10px;border-color:#e8eeea;border-radius:16px;box-shadow:0 3px 12px rgba(29,43,35,.035)}.product-image{border-radius:10px}.choice{padding:9px 13px;font-weight:500}',
    '.footer-link{padding:10px 16px 0;border:0;color:#78827d;text-decoration:none}.footer-link:hover{text-decoration:underline}',
    '.composer{align-items:flex-end;gap:8px;margin:12px 16px 16px;padding:6px 6px 6px 10px;border:1px solid #e4eae6;border-radius:18px;background:#fff;box-shadow:0 4px 18px rgba(29,43,35,.06);transition:border-color .2s ease,box-shadow .2s ease}',
    '.composer:focus-within{border-color:var(--accent);box-shadow:0 4px 20px rgba(29,43,35,.1)}',
    '.input{padding:10px 6px;border:0;border-radius:0;background:transparent;outline:none;color:#20252b}.input::placeholder{color:#939d97}.input:focus-visible{outline:none}',
    '.send{width:40px;height:40px;border-radius:13px;transition:opacity .2s ease,transform .2s ease}.send:not(:disabled):hover{transform:scale(1.05)}',
    '@media (max-width:480px){.panel.open{border:0;border-radius:26px 26px 0 0}.panel.open.expanded{border-radius:0}.header{padding:4px 18px 14px}.avatar{width:40px;height:40px;background:var(--accent);color:var(--on-accent)}.log{padding:18px;gap:12px;background:#f7f8f6}.log>.row:first-child .bubble{padding:13px 15px;border:1px solid #e9eeeb;border-radius:18px 18px 18px 6px;box-shadow:0 3px 12px rgba(29,43,35,.035)}.starters{flex-direction:row;flex-wrap:wrap}.starter{width:auto}.composer{margin:10px 14px max(12px,env(safe-area-inset-bottom));padding:6px 6px 6px 10px}.footer-link{padding-top:10px}}',
    '@media (prefers-reduced-motion:reduce){.launcher,.starter,.send,.composer{transition:none}.launcher:hover,.starter:hover,.send:not(:disabled):hover{transform:none}}',
    '@media (prefers-reduced-motion:reduce){.panel.open{transition:none}}',
    // Modern launcher: accent gradient, glossy rim, accent-tinted glow, pop-in.
    '.launcher{width:62px;height:62px;overflow:visible;isolation:isolate;background:radial-gradient(120% 120% at 30% 15%,color-mix(in srgb,var(--chat-primary) 70%,#fff) 0%,var(--chat-primary) 45%,color-mix(in srgb,var(--chat-primary) 78%,#000) 100%);box-shadow:0 12px 30px -6px color-mix(in srgb,var(--chat-primary) 60%,transparent),0 4px 12px rgba(15,23,42,.18),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -2px 6px rgba(0,0,0,.18);transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease;animation:launcher-in .5s cubic-bezier(.34,1.56,.64,1) both}',
    '.launcher:before{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid rgba(255,255,255,.28);pointer-events:none}',
    '.launcher:after{content:"";position:absolute;inset:0;z-index:-1;border-radius:50%;background:var(--chat-primary);opacity:0;animation:launcher-ring 2.4s ease-out 1s 2}',
    '.launcher:hover{transform:translateY(-3px) scale(1.05);box-shadow:0 18px 36px -8px color-mix(in srgb,var(--chat-primary) 70%,transparent),0 6px 16px rgba(15,23,42,.2),inset 0 1px 0 rgba(255,255,255,.4),inset 0 -2px 6px rgba(0,0,0,.18)}',
    '.launcher:active{transform:scale(.95)}',
    '.launcher .launcher-icon{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linejoin:round;filter:drop-shadow(0 1px 1px rgba(0,0,0,.15));transition:transform .3s cubic-bezier(.34,1.56,.64,1)}',
    '.launcher:hover .launcher-icon{transform:rotate(-8deg) scale(1.06)}',
    '.launcher .launcher-dot{fill:currentColor;stroke:none}',
    '.launcher:hover .launcher-dot{animation:launcher-dots 1s ease-in-out infinite}',
    '.launcher:hover .launcher-dot-1{animation-delay:.15s}.launcher:hover .launcher-dot-2{animation-delay:.3s}',
    '.launcher-indicator{right:1px;top:1px;width:16px;height:16px;border:2.5px solid #fff;background:#22c55e;box-shadow:0 2px 6px rgba(34,197,94,.45)}',
    '.launcher-indicator:empty:after{content:"";position:absolute;inset:-2.5px;border-radius:50%;background:#22c55e;animation:launcher-ping 2s cubic-bezier(0,0,.2,1) infinite;z-index:-1}',
    '.launcher-indicator:not(:empty){width:20px;height:20px;right:-2px;top:-2px;background:#ef4444;box-shadow:0 2px 6px rgba(239,68,68,.45);font-size:11px}',
    '@keyframes launcher-in{0%{opacity:0;transform:scale(.4) translateY(12px)}100%{opacity:1;transform:none}}',
    '@keyframes launcher-ring{0%{opacity:.45;transform:scale(1)}100%{opacity:0;transform:scale(1.6)}}',
    '@keyframes launcher-ping{0%{opacity:.7;transform:scale(1)}75%,100%{opacity:0;transform:scale(2.1)}}',
    '@keyframes launcher-dots{0%,100%{transform:translateY(0)}40%{transform:translateY(-1.5px)}}',
    '.launcher-dot{transform-box:fill-box;transform-origin:center}',
    '@media (prefers-reduced-motion:reduce){.launcher,.launcher:after,.launcher-indicator:after,.launcher .launcher-icon,.launcher-dot{animation:none!important;transition:none}.launcher:hover,.launcher:hover .launcher-icon{transform:none}}',
  ].join('');

  // A wrong key or unlisted site gets a 404 with no CORS headers, which the
  // browser reports as a failed fetch, so this catch is what tells the merchant.
  // It only warns: a chat widget error must never reach the merchant's page.
  fetch(apiBase + '/api/widget/config?key=' + encodeURIComponent(key), {
    credentials: 'omit',
  })
    .then(function (response) {
      if (!response.ok) throw new Error('Not available');
      return response.json();
    })
    .then(function (data) {
      config = data;
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount);
    })
    .catch(function () {
      console.warn(
        '[chat widget] Not shown: check the widget is on and this domain (' +
          location.hostname +
          ') is allowed.'
      );
    });
})();
