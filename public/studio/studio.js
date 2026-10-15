// Studio: a phone-friendly editor for whitcooper.com posts.
// Sign-in uses passkeys. Posts are saved to GitHub through /api/posts (see netlify/functions).
import { parsePost, serializePost, serializeBlock, slugify, videoEmbed, esc } from './post-format.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

// ---------- tiny helpers ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const mount = (...nodes) => { app.replaceChildren(...nodes); window.scrollTo(0, 0); };

let toastTimer;
function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), kind === 'bad' ? 6000 : 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- passkeys ----------
const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function registerPasskey(setupCode) {
  const opts = await api('/api/auth/register-options', { method: 'POST', body: { setupCode } });
  const cred = await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: dec(opts.challenge),
      user: { ...opts.user, id: dec(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
    },
  });
  if (!cred) throw new Error('No passkey was created.');
  const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Device';
  await api('/api/auth/register-verify', {
    method: 'POST',
    body: {
      setupCode,
      name: device,
      response: {
        id: cred.id, rawId: enc(cred.rawId), type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: enc(cred.response.clientDataJSON),
          attestationObject: enc(cred.response.attestationObject),
          transports: cred.response.getTransports?.() || [],
        },
      },
    },
  });
}

async function loginWithPasskey() {
  const opts = await api('/api/auth/login-options', { method: 'POST', body: {} });
  const cred = await navigator.credentials.get({
    publicKey: {
      ...opts,
      challenge: dec(opts.challenge),
      allowCredentials: (opts.allowCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
    },
  });
  if (!cred) throw new Error('Sign-in was cancelled.');
  await api('/api/auth/login-verify', {
    method: 'POST',
    body: {
      response: {
        id: cred.id, rawId: enc(cred.rawId), type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: enc(cred.response.clientDataJSON),
          authenticatorData: enc(cred.response.authenticatorData),
          signature: enc(cred.response.signature),
          userHandle: cred.response.userHandle ? enc(cred.response.userHandle) : undefined,
        },
      },
    },
  });
}

const friendlyPasskeyError = (e) =>
  e.name === 'NotAllowedError' ? 'That was cancelled or timed out. Try again.' : e.message;

// ---------- gate (sign in / setup) ----------
function renderGate(status) {
  const errEl = h('p', { class: 'err' });
  const card = h('div', { class: 'card' }, h('div', { class: 'orb' }), h('h1', { class: 'grad-text' }, 'Studio'));

  if (status.missing?.length) {
    card.append(
      h('p', { class: 'muted' }, 'Almost there. Studio needs a few settings in Netlify before it can start:'),
      h('div', { class: 'setup-list' }, status.missing.map((k) => h('div', {}, h('code', {}, k)))),
      h('p', { class: 'muted small' }, 'Add them under Netlify → Site configuration → Environment variables, then redeploy.'),
    );
    return mount(h('div', { class: 'gate' }, card));
  }

  const setupInput = h('input', { type: 'password', placeholder: 'Setup code', autocomplete: 'off', 'aria-label': 'Setup code' });
  const run = (btn, fn) => async () => {
    errEl.textContent = '';
    btn.disabled = true;
    try { await fn(); await boot(); } catch (e) { errEl.textContent = friendlyPasskeyError(e); } finally { btn.disabled = false; }
  };

  const setupBlock = h('div', { class: 'setup-list', style: 'display:grid;gap:10px' });
  const addBtn = h('button', {}, 'Create passkey on this device');
  addBtn.onclick = run(addBtn, () => registerPasskey(setupInput.value.trim()));
  setupBlock.append(setupInput, addBtn);

  if (status.hasPasskeys) {
    const signIn = h('button', { class: 'primary' }, 'Sign in with Face ID / Touch ID');
    signIn.onclick = run(signIn, loginWithPasskey);
    setupBlock.classList.add('hidden');
    const toggle = h('button', { class: 'ghost small', onclick: () => { setupBlock.classList.toggle('hidden'); } }, 'New device or lost your passkey?');
    card.append(h('p', { class: 'muted' }, 'Welcome back.'), signIn, errEl, toggle, setupBlock);
  } else {
    card.append(
      h('p', { class: 'muted' }, 'First time here. Enter your setup code, then create a passkey. It uses Face ID or Touch ID, so there is no password to remember.'),
      setupBlock, errEl,
    );
  }
  mount(h('div', { class: 'gate' }, card));
}

// ---------- posts list ----------
async function renderList() {
  const list = h('div', { class: 'posts' }, h('p', { class: 'muted' }, 'Loading posts…'));
  const addDevice = h('button', { class: 'ghost small' }, 'Add this device');
  addDevice.onclick = async () => {
    try { await registerPasskey(); toast('Passkey added for this device.', 'good'); }
    catch (e) { toast(friendlyPasskeyError(e), 'bad'); }
  };
  const signOut = h('button', { class: 'ghost small' }, 'Sign out');
  signOut.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); await boot(); };

  mount(h('div', { class: 'wrap' },
    h('div', { class: 'topbar' },
      h('h1', { class: 'grad-text' }, 'Studio'),
      h('div', { class: 'row' }, h('a', { class: 'btn small', href: '/', target: '_blank', rel: 'noopener' }, 'View site'),
        h('button', { class: 'primary', onclick: () => openEditor(null) }, '+ New post')),
    ),
    list,
    h('div', { class: 'row', style: 'margin-top:28px' }, addDevice, signOut),
  ));

  try {
    const { posts } = await api('/api/posts');
    cachedPosts = posts;
    if (!posts.length) return list.replaceChildren(h('p', { class: 'muted' }, 'No posts yet. Tap “New post” to write your first.'));
    list.replaceChildren(...posts.map((p) => {
      const date = p.date ? new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return h('button', { class: 'card post-item', onclick: () => openEditor(p.slug) },
        h('div', { class: 'thumb', style: p.coverImage ? `background-image:url("${encodeURI(p.coverImage)}")` : '' }),
        h('div', {}, h('h3', {}, p.title || p.slug), h('div', { class: 'muted small' }, date)),
        h('span', { class: p.draft ? 'chip' : 'chip live' }, p.draft ? 'Draft' : 'Live'),
      );
    }));
  } catch (e) {
    if (e.status === 401) return boot();
    list.replaceChildren(h('p', { class: 'err' }, e.message));
  }
}
let cachedPosts = [];

// ---------- images ----------
const pending = new Map(); // filename -> { base64, url }

async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const MAX = 2400;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let type = 'image/webp';
  let blob = await new Promise((r) => canvas.toBlob(r, type, 0.88));
  if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; blob = await new Promise((r) => canvas.toBlob(r, type, 0.9)); }
  return { blob, ext: type === 'image/webp' ? 'webp' : 'jpg' };
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

function chooseFiles(multiple) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', ...(multiple ? { multiple: true } : {}) });
    input.onchange = () => resolve([...input.files]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// Returns public paths like /uploads/name.webp for each chosen photo.
async function pickPhotos(multiple) {
  const files = await chooseFiles(multiple);
  const paths = [];
  for (const [i, file] of files.entries()) {
    toast(`Preparing photo ${i + 1} of ${files.length}…`);
    try {
      const { blob, ext } = await shrinkImage(file);
      const base = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40);
      const name = `${base}-${Date.now().toString(36)}${i}.${ext}`;
      pending.set(name, { base64: await toBase64(blob), url: URL.createObjectURL(blob) });
      paths.push(`/uploads/${name}`);
    } catch {
      toast(`Couldn't read “${file.name}”.`, 'bad');
    }
  }
  return paths;
}

const imgUrl = (src) => {
  const name = src?.startsWith('/uploads/') ? src.slice(9) : null;
  return pending.get(name)?.url || src || '';
};

// ---------- editor ----------
const nowISO = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};
const toInputValue = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromInputValue = (v) => {
  const d = new Date(v);
  if (isNaN(d)) return nowISO();
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${v}:00${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

const newBlock = {
  text: () => ({ type: 'text', text: '' }),
  heading: () => ({ type: 'heading', text: '' }),
  quote: () => ({ type: 'quote', text: '' }),
  video: () => ({ type: 'video', url: '' }),
  photo: (src = '') => ({ type: 'photo', src, alt: '', caption: '', size: 'full', align: 'center', aspect: 'natural' }),
  row: (srcs = []) => ({ type: 'row', cols: Math.min(Math.max(srcs.length, 2), 4), aspect: 'portrait', photos: srcs.map((src) => ({ src, alt: '', caption: '' })) }),
};

async function openEditor(slug) {
  let state;
  if (slug) {
    mount(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Opening…')));
    try {
      const file = await api(`/api/posts/${slug}`);
      const post = parsePost(file.raw);
      state = { slug, isNew: false, ...post };
    } catch (e) { toast(e.message, 'bad'); return renderList(); }
  } else {
    state = { slug: '', isNew: true, slugTouched: false, meta: { title: '', date: nowISO(), summary: '', coverImage: '', draft: true }, extra: [], blocks: [newBlock.text()] };
  }
  renderEditor(state);
}

function renderEditor(state) {
  let dirty = false;
  let saving = false;
  let previewTimer;
  const status = h('span', { class: 'status' }, state.isNew ? 'New post' : 'Saved');
  const frame = h('iframe', { class: 'preview-frame', title: 'Post preview' });
  const blocksEl = h('div', { style: 'display:grid;gap:12px' });
  let paneEdit, panePreview;

  const markDirty = () => {
    dirty = true;
    status.textContent = 'Unsaved changes';
    status.className = 'status dirty';
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 350);
  };
  const guard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.onbeforeunload = guard;

  // --- preview ---
  async function previewStyles() {
    if (previewStyles.cache) return previewStyles.cache;
    const live = cachedPosts.find((p) => !p.draft) || cachedPosts[0];
    let head = '';
    try {
      const html = await (await fetch(live ? `/blog/${live.slug}/` : '/')).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      head = [...doc.querySelectorAll('link[rel="stylesheet"], style')].map((n) => {
        if (n.tagName === 'LINK') n.setAttribute('href', new URL(n.getAttribute('href'), location.origin).href);
        return n.outerHTML;
      }).join('\n');
    } catch { /* preview falls back to plain styling */ }
    return (previewStyles.cache = head);
  }

  const blockHtml = (b) => {
    if (b.type === 'text') return window.marked ? window.marked.parse(b.text || '') : `<p>${esc(b.text)}</p>`;
    if (b.type === 'heading') return `<h2>${esc(b.text)}</h2>`;
    if (b.type === 'quote') return `<blockquote>${window.marked ? window.marked.parse(b.text || '') : esc(b.text)}</blockquote>`;
    return serializeBlock(b).replace(/src="(\/uploads\/[^"]+)"/g, (_, s) => `src="${esc(imgUrl(s))}"`);
  };

  async function refreshPreview() {
    const m = state.meta;
    const cover = m.coverImage ? `<div class="cover-wrap mb-4"><img src="${esc(imgUrl(m.coverImage))}" alt="" class="cover-img" /></div>` : '';
    const doc = `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/" target="_blank">
      <meta name="viewport" content="width=device-width, initial-scale=1">${await previewStyles()}
      <style>html,body{background:#0a0a0a!important;color:#fafafa}body{font-family:'Atkinson Hyperlegible',system-ui,sans-serif}</style></head>
      <body><main><article class="max-w-4xl mx-auto py-16 px-6">${cover}
      <header class="post-header wc-card p-8 mb-12"><h1 class="text-4xl md:text-5xl font-bold tracking-tight text-gradient leading-tight mb-6">${esc(m.title) || 'Untitled'}</h1>
      <div class="text-sm text-neutral-400">${new Date(m.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}${m.summary ? ' · ' + esc(m.summary) : ''}</div></header>
      <div class="post-content wc-card p-8 prose prose-invert prose-lg max-w-none">${state.blocks.map(blockHtml).join('\n')}</div>
      </article></main></body></html>`;
    frame.srcdoc = doc;
  }

  // --- block editors ---
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= state.blocks.length) return; [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]]; renderBlocks(); markDirty(); };
  const remove = (i) => { state.blocks.splice(i, 1); renderBlocks(); markDirty(); };

  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  const textArea = (b, key, placeholder, rows = 3) => {
    const ta = h('textarea', { rows, placeholder, value: b[key] });
    ta.oninput = () => { b[key] = ta.value; grow(ta); markDirty(); };
    queueMicrotask(() => grow(ta));
    return ta;
  };
  const select = (b, key, options) => {
    const s = h('select', { 'aria-label': key }, options.map(([v, label]) => h('option', { value: v, ...(String(b[key]) === String(v) ? { selected: true } : {}) }, label)));
    s.onchange = () => { b[key] = key === 'cols' ? Number(s.value) : s.value; markDirty(); };
    return s;
  };

  function blockCard(b, i) {
    const labels = { text: 'Text', heading: 'Heading', quote: 'Quote', photo: 'Photo', row: 'Photo row', video: 'Video' };
    const head = h('div', { class: 'block-head' }, h('span', { class: 'tag' }, labels[b.type] || b.type),
      h('div', { class: 'block-tools' },
        h('button', { class: 'ghost', 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'ghost', 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓'),
        h('button', { class: 'ghost danger', 'aria-label': 'Delete block', onclick: () => remove(i) }, '✕')));
    const body = [];

    if (b.type === 'text') body.push(textArea(b, 'text', 'Write something… Markdown works: **bold**, *italic*, [link](https://…)', 4));
    if (b.type === 'heading') body.push(h('input', { value: b.text, placeholder: 'Heading', oninput: (e) => { b.text = e.target.value; markDirty(); } }));
    if (b.type === 'quote') body.push(textArea(b, 'text', 'Quote…', 2));
    if (b.type === 'video') {
      const note = h('div', { class: 'muted small' }, 'Paste a YouTube or Vimeo link.');
      const input = h('input', { type: 'url', value: b.url, placeholder: 'https://vimeo.com/…' });
      input.oninput = () => { b.url = input.value.trim(); note.textContent = !b.url ? 'Paste a YouTube or Vimeo link.' : videoEmbed(b.url) ? 'Looks good — it will embed.' : 'Not a YouTube/Vimeo link, so it will show as a plain link.'; markDirty(); };
      body.push(input, note);
    }
    if (b.type === 'photo') {
      const thumb = h('div', { class: 'thumb', style: b.src ? `background-image:url("${imgUrl(b.src)}")` : '' }, b.src ? '' : 'No photo');
      const replace = h('button', {}, b.src ? 'Replace' : 'Choose photo');
      replace.onclick = async () => { const [p] = await pickPhotos(false); if (p) { b.src = p; renderBlocks(); markDirty(); } };
      body.push(h('div', { class: 'photo-edit' }, h('div', { style: 'display:grid;gap:8px;align-content:start' }, thumb, replace),
        h('div', { style: 'display:grid;gap:8px;align-content:start' },
          h('input', { value: b.caption, placeholder: 'Caption (optional)', oninput: (e) => { b.caption = e.target.value; markDirty(); } }),
          h('input', { value: b.alt, placeholder: 'Describe the photo (alt text)', oninput: (e) => { b.alt = e.target.value; markDirty(); } }),
          h('div', { class: 'opts' },
            select(b, 'size', [['full', 'Full'], ['large', 'Large'], ['medium', 'Medium'], ['small', 'Small']]),
            select(b, 'align', [['center', 'Center'], ['left', 'Left'], ['right', 'Right']]),
            select(b, 'aspect', [['natural', 'Natural'], ['portrait', 'Portrait'], ['square', 'Square'], ['landscape', 'Wide']])))));
    }
    if (b.type === 'row') {
      const grid = h('div', { class: 'row-grid' }, b.photos.map((p, pi) => h('div', { class: 'row-photo' },
        h('div', { class: 'thumb', style: `background-image:url("${imgUrl(p.src)}")` },
          h('button', { class: 'x', 'aria-label': 'Remove photo', onclick: () => { b.photos.splice(pi, 1); renderBlocks(); markDirty(); } }, '✕')),
        h('input', { value: p.caption, placeholder: 'Caption', oninput: (e) => { p.caption = e.target.value; markDirty(); } }))));
      const add = h('button', {}, '+ Add photos');
      add.onclick = async () => { const ps = await pickPhotos(true); if (ps.length) { b.photos.push(...ps.map((src) => ({ src, alt: '', caption: '' }))); renderBlocks(); markDirty(); } };
      body.push(grid, h('div', { class: 'opts', style: 'grid-template-columns:1fr 1fr 1fr' }, add,
        select(b, 'cols', [[2, '2 across'], [3, '3 across'], [4, '4 across']]),
        select(b, 'aspect', [['portrait', 'Portrait'], ['natural', 'Natural'], ['square', 'Square'], ['landscape', 'Wide']])));
    }
    return h('div', { class: 'card block' }, head, ...body);
  }

  function renderBlocks() { blocksEl.replaceChildren(...state.blocks.map(blockCard)); }

  // --- metadata ---
  const m = state.meta;
  const titleInput = h('input', { class: 'title-input', value: m.title, placeholder: 'Post title', 'aria-label': 'Title' });
  const slugInput = h('input', { value: state.slug, placeholder: 'post-address', disabled: !state.isNew, 'aria-label': 'Web address' });
  titleInput.oninput = () => {
    m.title = titleInput.value;
    if (state.isNew && !state.slugTouched) slugInput.value = state.slug = slugify(m.title);
    markDirty();
  };
  slugInput.oninput = () => { state.slugTouched = true; state.slug = slugify(slugInput.value); markDirty(); };
  const dateInput = h('input', { type: 'datetime-local', value: toInputValue(m.date), 'aria-label': 'Date' });
  dateInput.onchange = () => { if (dateInput.value) { m.date = fromInputValue(dateInput.value); markDirty(); } };
  const summaryInput = h('textarea', { rows: 2, placeholder: 'One-line summary (shows in link previews)', value: m.summary });
  summaryInput.oninput = () => { m.summary = summaryInput.value; grow(summaryInput); markDirty(); };

  const coverThumb = h('div', { class: 'thumb' });
  const paintCover = () => { coverThumb.style.backgroundImage = m.coverImage ? `url("${imgUrl(m.coverImage)}")` : ''; };
  paintCover();
  const coverBtn = h('button', {}, 'Choose cover photo');
  coverBtn.onclick = async () => { const [p] = await pickPhotos(false); if (p) { m.coverImage = p; paintCover(); markDirty(); } };
  const coverClear = h('button', { class: 'ghost small', onclick: () => { m.coverImage = ''; paintCover(); markDirty(); } }, 'Remove');

  // --- saving ---
  async function save(publish) {
    if (saving) return;
    if (!m.title.trim()) return toast('Give the post a title first.', 'bad');
    if (!state.slug) return toast('The web address is empty.', 'bad');
    if (publish && !confirm('Publish now? It goes live on whitcooper.com in about a minute.')) return;
    saving = true;
    saveBtns.forEach((b) => (b.disabled = true));
    status.textContent = 'Saving…';
    try {
      const blocks = state.blocks.filter((b) => !(b.type === 'photo' && !b.src) && !(b.type === 'row' && !b.photos.length));
      const raw = serializePost({ meta: { ...m, draft: !publish }, extra: state.extra, blocks });
      const files = [...pending.entries()]
        .filter(([name]) => raw.includes(`/uploads/${name}`))
        .map(([name, f]) => ({ name, base64: f.base64 }));
      await api(`/api/posts/${state.slug}`, { method: 'PUT', body: { raw, files, isNew: state.isNew } });
      files.forEach((f) => pending.delete(f.name));
      m.draft = !publish;
      state.blocks = blocks;
      state.isNew = false;
      slugInput.disabled = true;
      dirty = false;
      status.textContent = publish ? 'Published' : 'Draft saved';
      status.className = 'status';
      renderBlocks();
      toast(publish ? 'Published! It will be live in about a minute.' : 'Draft saved. Not visible on the site.', 'good');
    } catch (e) {
      status.textContent = 'Not saved';
      status.className = 'status dirty';
      if (e.status === 401) { toast('Your session ended. Sign in again — your edits are still here.', 'bad'); }
      else toast(e.message, 'bad');
    } finally { saving = false; saveBtns.forEach((b) => (b.disabled = false)); }
  }

  const draftBtn = h('button', { onclick: () => save(false) }, 'Save draft');
  const publishBtn = h('button', { class: 'primary', onclick: () => save(true) }, state.meta.draft ? 'Publish' : 'Update live post');
  const saveBtns = [draftBtn, publishBtn];

  const back = h('button', { class: 'ghost', onclick: () => { if (dirty && !confirm('Leave without saving your changes?')) return; window.onbeforeunload = null; renderList(); } }, '← Posts');
  const del = h('button', { class: 'ghost danger small', onclick: async () => {
    if (!confirm(`Delete “${m.title}”? It is removed from the site (it stays in GitHub history).`)) return;
    try { await api(`/api/posts/${state.slug}`, { method: 'DELETE' }); dirty = false; window.onbeforeunload = null; toast('Post deleted.', 'good'); renderList(); } catch (e) { toast(e.message, 'bad'); }
  } }, 'Delete post');

  const addBar = h('div', { class: 'addbar', role: 'toolbar', 'aria-label': 'Add a block' },
    [['Text', () => newBlock.text()], ['Heading', () => newBlock.heading()], ['Photo', async () => { const [p] = await pickPhotos(false); return p ? newBlock.photo(p) : null; }],
      ['Photo row', async () => { const ps = await pickPhotos(true); return ps.length ? newBlock.row(ps) : null; }], ['Video', () => newBlock.video()], ['Quote', () => newBlock.quote()]]
      .map(([label, make]) => h('button', { onclick: async () => { const block = await make(); if (!block) return; state.blocks.push(block); renderBlocks(); markDirty(); blocksEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, `+ ${label}`)));

  const tabEdit = h('button', { role: 'tab', 'aria-selected': 'true' }, 'Edit');
  const tabPrev = h('button', { role: 'tab', 'aria-selected': 'false' }, 'Preview');
  const show = (which) => {
    paneEdit.classList.toggle('off', which !== 'edit'); panePreview.classList.toggle('off', which !== 'preview');
    tabEdit.setAttribute('aria-selected', which === 'edit'); tabPrev.setAttribute('aria-selected', which === 'preview');
    if (which === 'preview') refreshPreview();
  };
  tabEdit.onclick = () => show('edit'); tabPrev.onclick = () => show('preview');

  paneEdit = h('div', { class: 'pane-edit' },
    h('div', { class: 'card meta' }, titleInput,
      h('div', { class: 'two' }, h('label', { class: 'field' }, 'Date', dateInput), h('label', { class: 'field' }, 'Web address', slugInput)),
      summaryInput,
      h('div', { class: 'cover-row' }, coverThumb, h('div', { class: 'row' }, coverBtn, coverClear))),
    blocksEl, addBar);
  panePreview = h('div', { class: 'pane-preview off' }, frame);

  mount(h('div', { class: 'wrap' },
    h('div', { class: 'topbar' }, back,
      h('div', { class: 'savebar' }, status, draftBtn, publishBtn)),
    h('div', { class: 'tabs', role: 'tablist', style: 'margin-bottom:14px' }, tabEdit, tabPrev),
    h('div', { class: 'editor' }, paneEdit, panePreview),
    state.isNew ? null : h('div', { style: 'margin-top:24px' }, del)));
  renderBlocks();
  grow(summaryInput);
  refreshPreview();
}

// ---------- boot ----------
async function boot() {
  try {
    const status = await api('/api/auth/status');
    if (status.authed) return renderList();
    renderGate(status);
  } catch (e) {
    mount(h('div', { class: 'gate' }, h('div', { class: 'card' }, h('div', { class: 'orb' }), h('p', { class: 'err' }, e.message))));
  }
}

if (!window.PublicKeyCredential) {
  mount(h('div', { class: 'gate' }, h('div', { class: 'card' }, h('h1', {}, 'Studio'), h('p', { class: 'muted' }, 'This browser does not support passkeys. Try Safari or Chrome.'))));
} else boot();
