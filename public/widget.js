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
  var refs = {};

  function loadItems() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
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
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
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

    (item.products || []).forEach(function (product) {
      var card = renderProduct(product);
      if (card) row.appendChild(card);
    });

    var whatsapp = item.whatsappUrl && httpsUrl(item.whatsappUrl);
    if (whatsapp) {
      row.appendChild(externalLink(whatsapp, 'whatsapp-cta', 'Continue on WhatsApp'));
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
    log.appendChild(renderItem({ role: 'assistant', content: config.greeting }, false));
    items.forEach(function (item, index) {
      log.appendChild(renderItem(item, !sending && index === items.length - 1));
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
  }

  /** The transcript the server needs. Display-only fields stay in the browser. */
  function transcript() {
    return items
      .filter(function (item) {
        return !item.isError;
      })
      .slice(-MAX_TURNS)
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

  function send(raw) {
    var text = String(raw || '').trim().slice(0, MAX_INPUT);
    if (!text || sending) return;
    items.push({ role: 'user', content: text });
    sending = true;
    saveItems();
    render();

    fetch(apiBase + '/api/widget/chat?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ messages: transcript() }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
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
        });
      })
      .catch(function () {
        items.push({ role: 'assistant', isError: true, content: DEFAULT_ERROR });
      })
      .then(function () {
        sending = false;
        saveItems();
        render();
        if (refs.panel.classList.contains('open')) refs.input.focus();
      });
  }

  function setOpen(open) {
    refs.panel.classList.toggle('open', open);
    refs.launcher.classList.toggle('hidden', open);
    refs.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      refs.log.scrollTop = refs.log.scrollHeight;
      refs.input.focus();
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
    var host = el('div');
    host.id = 'chat-widget-root';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = el('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var root = el('div', 'root');
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

    var panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', config.title);
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });

    var header = el('div', 'header');
    header.appendChild(el('div', 'title', config.title));
    var close = el('button', 'close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.appendChild(icon(CLOSE_ICON));
    close.addEventListener('click', function () {
      setOpen(false);
    });
    header.appendChild(close);

    var log = el('div', 'log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');

    var form = el('form', 'composer');
    var input = el('textarea', 'input');
    input.rows = 1;
    input.maxLength = MAX_INPUT;
    input.placeholder = 'Type your message';
    input.setAttribute('aria-label', 'Type your message');
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

    panel.appendChild(header);
    panel.appendChild(log);
    var whatsapp = config.whatsapp_url && httpsUrl(config.whatsapp_url);
    if (whatsapp) {
      panel.appendChild(externalLink(whatsapp, 'footer-link', 'Prefer WhatsApp? Chat with us there'));
    }
    panel.appendChild(form);

    root.appendChild(panel);
    root.appendChild(launcher);
    shadow.appendChild(root);
    document.body.appendChild(host);

    refs = { panel: panel, launcher: launcher, log: log, input: input, send: submit };
    render();
  }

  var CHAT_ICON =
    'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 1-2z';
  var CLOSE_ICON =
    'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z';
  var SEND_ICON = 'M3 20.5v-6.2l12-2.3-12-2.3V3.5L22 12z';

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.root{position:fixed;right:20px;bottom:20px;z-index:2147483000;color:#1f2328;font-size:14px;line-height:1.45}',
    'svg{width:24px;height:24px;fill:currentColor;display:block}',
    'button{cursor:pointer;font:inherit}',
    'a:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.launcher{width:56px;height:56px;border:0;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25)}',
    '.launcher.hidden{display:none}',
    '.panel{display:none;flex-direction:column;width:370px;height:560px;max-height:calc(100vh - 40px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28)}',
    '.panel.open{display:flex}',
    '.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 12px 12px 16px;background:var(--accent);color:var(--on-accent)}',
    '.title{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.close{width:32px;height:32px;padding:4px;border:0;border-radius:8px;background:transparent;color:inherit;flex:none}',
    '.close:focus-visible{outline-color:var(--on-accent)}',
    '.log{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px;background:#f6f7f8;display:flex;flex-direction:column;gap:10px}',
    '.row{display:flex;flex-direction:column;gap:6px;max-width:85%}',
    '.row-user{align-self:flex-end;align-items:flex-end}',
    '.row-bot{align-self:flex-start;align-items:flex-start}',
    '.bubble{padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #e6e8eb}',
    '.row-user .bubble{background:var(--accent);color:var(--on-accent);border-color:transparent}',
    '.inline-link{color:inherit;text-decoration:underline}',
    '.product{display:flex;gap:10px;width:100%;min-width:240px;padding:8px;background:#fff;border:1px solid #e6e8eb;border-radius:12px;color:inherit;text-decoration:none}',
    '.product:hover{border-color:var(--accent)}',
    '.product-image{width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none;background:#eef0f2}',
    '.product-body{display:flex;flex-direction:column;min-width:0;gap:1px}',
    '.product-title{font-weight:600;overflow-wrap:anywhere}',
    '.product-variant{color:#5b6470;font-size:13px}',
    '.product-price{font-size:13px}',
    '.product-cta{color:var(--accent);font-weight:600;font-size:13px;margin-top:2px}',
    '.whatsapp-cta{display:inline-block;padding:9px 14px;border-radius:999px;background:#128c7e;color:#fff;font-weight:600;text-decoration:none}',
    '.choices{display:flex;flex-wrap:wrap;gap:6px}',
    '.choice{padding:7px 12px;border-radius:999px;border:1px solid var(--accent);background:#fff;color:#1f2328}',
    '.typing{display:flex;gap:4px;padding:13px 12px}',
    '.typing span{width:6px;height:6px;border-radius:50%;background:#8a93a0;animation:pulse 1.2s infinite}',
    '.typing span:nth-child(2){animation-delay:.2s}',
    '.typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes pulse{0%,60%,100%{opacity:.35}30%{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.typing span{animation:none}}',
    '.footer-link{display:block;padding:7px 12px;text-align:center;font-size:12px;color:#5b6470;background:#fff;border-top:1px solid #e6e8eb;text-decoration:underline}',
    '.composer{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e6e8eb}',
    '.input{flex:1;min-width:0;resize:none;max-height:96px;padding:8px 10px;border:1px solid #d5d9de;border-radius:10px;font-size:14px;line-height:1.4;color:#1f2328;background:#fff}',
    '.send{width:38px;height:38px;padding:9px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);flex:none}',
    '.send svg{width:20px;height:20px}',
    '.send:disabled{opacity:.5;cursor:default}',
    // Full screen on phones. 16px input text stops iOS zooming in on focus.
    '@media (max-width:480px){.root{right:16px;bottom:16px}.panel.open{position:fixed;inset:0;width:100%;height:100%;max-height:none;border-radius:0}.input{font-size:16px}.composer{padding-bottom:max(10px,env(safe-area-inset-bottom))}}',
  ].join('');

  // A wrong key or unlisted site gets a 404, and the widget simply stays off.
  fetch(apiBase + '/api/widget/config?key=' + encodeURIComponent(key), {
    credentials: 'omit',
  })
    .then(function (response) {
      if (!response.ok) {
        console.warn(
          '[chat widget] Not shown: check the widget is on and this domain is allowed.'
        );
        return null;
      }
      return response.json();
    })
    .then(function (data) {
      if (!data) return;
      config = data;
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount);
    })
    .catch(function () {
      /* Never let a chat widget error reach the merchant's page. */
    });
})();
