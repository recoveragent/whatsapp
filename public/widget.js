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
  var sessionVersion = 0;
  var refs = {};

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
    appendLinkified(bubble, item.content);
    row.appendChild(bubble);

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

    (item.products || []).forEach(function (product) {
      var card = renderProduct(product);
      if (card) row.appendChild(card);
    });

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

  function render() {
    var log = refs.log;
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
    items.forEach(function (item, index) {
      log.appendChild(renderItem(item, !sending && (index === items.length - 1 || (index === items.length - 2 && items[index + 1].phonePrompt))));
    });
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
      body: JSON.stringify({ messages: transcript(), session_key: sessionKey, product_handle: currentProductHandle() }),
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
        items.push({
          role: 'assistant',
          content: body.reply,
          products: body.products || [],
          quickReplies: body.quick_replies || [],
          whatsappUrl: body.handoff ? body.whatsapp_url : null,
          handoff: Boolean(body.handoff),
        });
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

  function setOpen(open) {
    refs.panel.classList.toggle('open', open);
    refs.backdrop.classList.toggle('open', open);
    refs.launcher.classList.toggle('hidden', open);
    refs.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      setExpanded(false);
      refs.log.scrollTop = refs.log.scrollHeight;
      if (window.matchMedia('(max-width:480px)').matches) refs.close.focus({ preventScroll: true });
      else refs.input.focus();
    } else {
      refs.launcher.focus();
    }
  }

  function icon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
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
    root.style.setProperty('--chat-primary-contrast', contrastColor(config.accent_color));
    root.style.setProperty('--accent', config.accent_color);
    root.style.setProperty('--on-accent', contrastColor(config.accent_color));

    var launcher = el('button', 'launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.appendChild(icon(CHAT_ICON));
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
    shadow.appendChild(root);
    document.body.appendChild(host);

    refs = { panel: panel, backdrop: backdrop, launcher: launcher, close: close, expand: expand, log: log, input: input, send: submit };
    render();
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
    'a:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.launcher{width:56px;height:56px;border:0;border-radius:50%;background:var(--chat-primary);color:var(--chat-primary-contrast);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)}',
    '.launcher.hidden{display:none}',
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
    '.product{display:flex;gap:10px;width:100%;min-width:240px;padding:8px;background:#fff;border:1px solid #e6e8eb;border-radius:12px;color:inherit;text-decoration:none}',
    '.product:hover{border-color:var(--accent)}',
    '.product-image{width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none;background:#eef0f2}',
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
    '@media (prefers-reduced-motion:reduce){.panel.open{transition:none}}',
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
