// Studio screens for the rest of the site: projects, skills and the home page.
// Each screen reads and saves through /api/content (see netlify/functions/content.mjs).
import { splitFile } from './post-format.js';

const TAGS = ['Editing', 'Motion Graphics', 'VFX', 'Color', 'Sound Design'];

export function makeSite(ctx) {
  const { h, api, mount, toast, pickPhotos, imgUrl, pending, slugify, tabs, textGrow, chooseFiles, processPhoto, toBase64 } = ctx;
  const SAVED = 'Saved. The site rebuilds and updates in about a minute.';

  const field = (label, control, hint) => h('label', { class: 'field' }, label, control, hint ? h('span', { class: 'muted small' }, hint) : null);
  const guard = () => {
    const st = { dirty: false };
    window.onbeforeunload = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
    return st;
  };
  const leave = (st, go) => () => { if (st.dirty && !confirm('Leave without saving your changes?')) return; window.onbeforeunload = null; go(); };
  const shell = (active, ...kids) => mount(h('div', { class: 'wrap' }, h('div', { class: 'topbar' }, h('h1', { class: 'grad-text' }, 'Studio'),
    h('div', { class: 'row' }, h('a', { class: 'btn small', href: '/', target: '_blank', rel: 'noopener' }, 'View site'))), tabs(active), ...kids));
  const ta = (value, placeholder, rows = 3) => { const t = h('textarea', { rows, placeholder, value }); queueMicrotask(() => textGrow(t)); t.addEventListener('input', () => textGrow(t)); return t; };

  // ================= projects =================
  function parseProject(raw) {
    const { fm, body } = splitFile(raw);
    const one = (k) => { const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); if (!m) return ''; const v = m[1].trim(); try { return v.startsWith('"') ? JSON.parse(v) : v.replace(/^'|'$/g, ''); } catch { return v; } };
    // descriptions may be wrapped over several lines in older files
    const desc = (() => { const m = fm.match(/^description:\s*((?:.*)(?:\n[ \t]+.*)*)/m); return m ? m[1].replace(/\n[ \t]+/g, ' ').trim().replace(/^["']|["']$/g, '') : ''; })();
    const tagBlock = (fm.match(/^tags:\s*\n((?:\s+-\s.*\n?)*)/m) || [, ''])[1];
    return { title: one('title'), videoURL: one('videoURL'), description: desc, thumbnail: one('thumbnail'), tags: [...tagBlock.matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim()), body };
  }
  const projectRaw = (p) => `---\ntitle: ${JSON.stringify(p.title)}\nvideoURL: ${JSON.stringify(p.videoURL)}\ntags:\n${p.tags.map((t) => `  - ${t}`).join('\n')}\n${p.description ? `description: ${JSON.stringify(p.description)}\n` : ''}${p.thumbnail ? `thumbnail: ${JSON.stringify(p.thumbnail)}\n` : ''}---\n${p.body || ''}`;

  async function projects() {
    const list = h('div', { class: 'posts' }, h('p', { class: 'muted' }, 'Loading projects…'));
    shell('projects', h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'primary', onclick: () => editProject(null) }, '+ New project')), list);
    try {
      const { projects: items } = await api('/api/content/projects');
      list.replaceChildren(...items.map((p) => h('button', { class: 'card post-item', onclick: () => editProject(p.slug) },
        h('div', { class: 'thumb', style: p.thumbnail ? `background-image:url("${encodeURI(p.thumbnail)}")` : '' }),
        h('div', {}, h('h3', {}, p.title || p.slug), h('div', { class: 'muted small' }, p.tags.join(' · '))), h('span', {}))));
    } catch (e) { list.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function editProject(slug) {
    let p = { title: '', videoURL: '', description: '', thumbnail: '', tags: [], body: '' };
    const isNew = !slug;
    if (slug) {
      mount(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Opening…')));
      try { p = parseProject((await api(`/api/content/projects/${slug}`)).raw); } catch (e) { toast(e.message, 'bad'); return projects(); }
    }
    let address = slug || '';
    const st = guard();
    const dirty = () => { st.dirty = true; status.textContent = 'Unsaved changes'; status.className = 'status dirty'; };
    const status = h('span', { class: 'status' }, isNew ? 'New project' : 'Saved');
    const title = h('input', { class: 'title-input', value: p.title, placeholder: 'Project title' });
    const addr = h('input', { value: address, placeholder: 'project-address', disabled: !isNew });
    title.oninput = () => { p.title = title.value; if (isNew) addr.value = address = slugify(p.title); dirty(); };
    addr.oninput = () => { address = slugify(addr.value); dirty(); };
    const video = h('input', { type: 'url', value: p.videoURL, placeholder: 'https://vimeo.com/…' });
    video.oninput = () => { p.videoURL = video.value.trim(); dirty(); };
    const desc = ta(p.description, 'What is this project? A few sentences.', 4);
    desc.oninput = () => { p.description = desc.value; textGrow(desc); dirty(); };
    const chips = h('div', { class: 'row' }, TAGS.map((t) => { const b = h('button', { 'aria-pressed': String(p.tags.includes(t)), class: 'chipbtn' }, t); b.onclick = () => { p.tags = p.tags.includes(t) ? p.tags.filter((x) => x !== t) : [...p.tags, t]; b.setAttribute('aria-pressed', String(p.tags.includes(t))); dirty(); }; return b; }));
    const thumb = h('div', { class: 'thumb', style: 'width:120px;height:75px;border-radius:12px;background:var(--card-2) center/cover' });
    const paint = () => { thumb.style.backgroundImage = p.thumbnail ? `url("${imgUrl(p.thumbnail)}")` : ''; };
    paint();
    const pick = h('button', {}, 'Choose thumbnail');
    pick.onclick = async () => { const [x] = await pickPhotos(false); if (x) { p.thumbnail = x; paint(); dirty(); } };

    const save = h('button', { class: 'primary' }, 'Save to site');
    save.onclick = async () => {
      if (!p.title.trim()) return toast('Give the project a title.', 'bad');
      if (!address) return toast('The address is empty.', 'bad');
      if (!p.videoURL) return toast('Add a video link.', 'bad');
      if (!p.tags.length) return toast('Pick at least one tag.', 'bad');
      save.disabled = true; status.textContent = 'Saving…';
      try {
        const raw = projectRaw(p);
        const files = [...pending.entries()].filter(([n]) => raw.includes(`/uploads/${n}`)).map(([name, f]) => ({ name, base64: f.base64 }));
        await api(`/api/content/projects/${address}`, { method: 'PUT', body: { raw, files, isNew } });
        files.forEach((f) => pending.delete(f.name));
        st.dirty = false; status.textContent = 'Saved'; status.className = 'status'; addr.disabled = true; toast(SAVED, 'good');
      } catch (e) { status.textContent = 'Not saved'; status.className = 'status dirty'; toast(e.message, 'bad'); } finally { save.disabled = false; }
    };
    const del = isNew ? null : h('button', { class: 'ghost danger small', onclick: async () => {
      if (!confirm(`Delete “${p.title}”? It disappears from the site (it stays in GitHub history).`)) return;
      try { await api(`/api/content/projects/${address}`, { method: 'DELETE' }); st.dirty = false; window.onbeforeunload = null; toast('Project deleted.', 'good'); projects(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Delete project');
    mount(h('div', { class: 'wrap' }, h('div', { class: 'topbar' }, h('button', { class: 'ghost', onclick: leave(st, projects) }, '← Projects'), h('div', { class: 'savebar' }, status, save)),
      h('div', { class: 'card meta', style: 'max-width:720px' }, title, field('Web address', addr), field('Video link', video, 'Vimeo or YouTube. Visitors open it from the home page.'), field('Description', desc),
        field('Tags', chips), h('div', { class: 'cover-row' }, thumb, pick)), del ? h('div', { style: 'margin-top:24px' }, del) : null));
  }

  // ================= skills =================
  async function skills() {
    const list = h('div', { class: 'posts' }, h('p', { class: 'muted' }, 'Loading skills…'));
    let items = [];
    shell('skills', h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'primary', onclick: () => editSkill(null, items) }, '+ New skill'), h('span', { class: 'muted small' }, 'Shown on the home page under “What I do”, in this order.')), list);
    try {
      items = (await api('/api/content/skills')).skills;
      list.replaceChildren(...items.map((s, i) => h('button', { class: 'card post-item', style: 'grid-template-columns:44px 1fr auto', onclick: () => editSkill(s.slug, items) },
        h('div', { class: 'muted', style: 'font-size:1.4rem;text-align:center' }, String(i + 1)), h('div', {}, h('h3', {}, s.name), h('div', { class: 'muted small' }, s.pov.slice(0, 80) + (s.pov.length > 80 ? '…' : ''))), h('span', {}))));
    } catch (e) { list.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function editSkill(slug, items) {
    const isNew = !slug;
    let s = { name: '', pov: '', order: (items.length ? Math.max(...items.map((x) => x.order ?? 0)) : 0) + 1, highlights: [] };
    if (slug) { const f = items.find((x) => x.slug === slug); s = { ...s, ...f }; s.highlights = (f.highlights || []).map((x) => ({ ...x })); }
    let address = slug || '';
    const st = guard();
    const status = h('span', { class: 'status' }, isNew ? 'New skill' : 'Saved');
    const dirty = () => { st.dirty = true; status.textContent = 'Unsaved changes'; status.className = 'status dirty'; };
    const name = h('input', { class: 'title-input', value: s.name, placeholder: 'Skill name' });
    const addr = h('input', { value: address, disabled: !isNew });
    name.oninput = () => { s.name = name.value; if (isNew) addr.value = address = slugify(s.name); dirty(); };
    const order = h('input', { type: 'number', min: 0, max: 999, value: s.order });
    order.oninput = () => { s.order = order.value === '' ? undefined : Number(order.value); dirty(); };
    const pov = ta(s.pov, 'A short, confident description.', 3);
    pov.oninput = () => { s.pov = pov.value; textGrow(pov); dirty(); };
    const hl = h('div', { style: 'display:grid;gap:8px' });
    const paintHl = () => hl.replaceChildren(...s.highlights.map((x, i) => h('div', { class: 'row', style: 'flex-wrap:nowrap' },
      h('input', { value: x.item, placeholder: 'Highlight', oninput: (e) => { x.item = e.target.value; dirty(); } }),
      h('button', { class: 'ghost danger icon', 'aria-label': 'Remove', onclick: () => { s.highlights.splice(i, 1); paintHl(); dirty(); } }, '✕'))));
    paintHl();
    const addHl = h('button', { onclick: () => { if (s.highlights.length >= 8) return toast('Up to 8 highlights.', 'bad'); s.highlights.push({ item: '' }); paintHl(); dirty(); } }, '+ Add highlight');
    const save = h('button', { class: 'primary' }, 'Save to site');
    save.onclick = async () => {
      if (!s.name.trim() || !s.pov.trim()) return toast('Add a name and a description.', 'bad');
      if (!address) return toast('The address is empty.', 'bad');
      const data = { name: s.name, pov: s.pov, order: s.order, highlights: s.highlights.filter((x) => x.item.trim()) };
      save.disabled = true; status.textContent = 'Saving…';
      try { await api(`/api/content/skills/${address}`, { method: 'PUT', body: { data, isNew } }); st.dirty = false; status.textContent = 'Saved'; status.className = 'status'; addr.disabled = true; toast(SAVED, 'good'); }
      catch (e) { status.textContent = 'Not saved'; status.className = 'status dirty'; toast(e.message, 'bad'); } finally { save.disabled = false; }
    };
    const del = isNew ? null : h('button', { class: 'ghost danger small', onclick: async () => {
      if (!confirm(`Delete “${s.name}”?`)) return;
      try { await api(`/api/content/skills/${address}`, { method: 'DELETE' }); st.dirty = false; window.onbeforeunload = null; toast('Skill deleted.', 'good'); skills(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Delete skill');
    mount(h('div', { class: 'wrap' }, h('div', { class: 'topbar' }, h('button', { class: 'ghost', onclick: leave(st, skills) }, '← Skills'), h('div', { class: 'savebar' }, status, save)),
      h('div', { class: 'card meta', style: 'max-width:720px' }, name, h('div', { class: 'two' }, field('Order on the page', order, 'Lower numbers come first.'), field('Web address', addr)),
        field('Description', pov), field('Highlights', hl), addHl), del ? h('div', { style: 'margin-top:24px' }, del) : null));
  }

  // ================= home page =================
  async function home() {
    shell('home', h('p', { class: 'muted' }, 'Loading…'));
    let data, projectList;
    try { [{ data }, { projects: projectList }] = await Promise.all([api('/api/content/home'), api('/api/content/projects')]); }
    catch (e) { return shell('home', h('p', { class: 'err' }, e.message)); }
    const d = { tagline: data.tagline || '', intro: data.intro || '', featured: [...(data.featured || [])] };
    const st = guard();
    const status = h('span', { class: 'status' }, 'Saved');
    const dirty = () => { st.dirty = true; status.textContent = 'Unsaved changes'; status.className = 'status dirty'; };
    const tagline = h('input', { value: d.tagline, placeholder: 'Editor · Motion · Color · Wizard' });
    tagline.oninput = () => { d.tagline = tagline.value; dirty(); };
    const intro = ta(d.intro, 'A few sentences about you.', 6);
    intro.oninput = () => { d.intro = intro.value; textGrow(intro); dirty(); };
    const picks = [0, 1, 2].map((i) => {
      const sel = h('select', { 'aria-label': `Best three, number ${i + 1}` }, h('option', { value: '' }, '(none)'), projectList.map((p) => h('option', { value: p.slug, ...(d.featured[i] === p.slug ? { selected: true } : {}) }, p.title || p.slug)));
      sel.onchange = () => { d.featured[i] = sel.value; dirty(); };
      return field(`Best three, number ${i + 1}`, sel);
    });
    const save = h('button', { class: 'primary' }, 'Save to site');
    save.onclick = async () => {
      save.disabled = true; status.textContent = 'Saving…';
      try { await api('/api/content/home', { method: 'PUT', body: { data: { ...d, featured: d.featured.filter(Boolean) } } }); st.dirty = false; status.textContent = 'Saved'; status.className = 'status'; toast(SAVED, 'good'); }
      catch (e) { status.textContent = 'Not saved'; status.className = 'status dirty'; toast(e.message, 'bad'); } finally { save.disabled = false; }
    };
    shell('home', h('div', { class: 'savebar', style: 'margin-bottom:14px' }, status, save),
      h('div', { class: 'card meta', style: 'max-width:720px' }, field('Tagline under the logo', tagline), field('Intro', intro, 'Formatting works: **bold**, *italic*, [link](https://…)'), h('h3', { style: 'margin-top:8px' }, 'Best three'), h('p', { class: 'muted small', style: 'margin:0' }, 'The three projects shown on the home page. Add or edit projects on the Projects tab.'), ...picks));
  }

  // ================= gallery =================
  async function gallery() {
    const list = h('div', { class: 'posts' }, h('p', { class: 'muted' }, 'Loading collections…'));
    shell('gallery', h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'primary', onclick: () => editGallery(null) }, '+ New collection'),
      h('span', { class: 'muted small' }, 'Photos are resized for you. Thumbnails keep the page fast.')), list);
    try {
      const { collections } = await api('/api/content/gallery');
      if (!collections.length) return list.replaceChildren(h('p', { class: 'muted' }, 'No collections yet. Tap “New collection” to make your first.'));
      list.replaceChildren(...collections.map((c) => h('button', { class: 'card post-item', onclick: () => editGallery(c.slug) },
        h('div', { class: 'thumb', style: c.coverThumb ? `background-image:url("${encodeURI(c.coverThumb)}")` : '' }),
        h('div', {}, h('h3', {}, c.title || c.slug), h('div', { class: 'muted small' }, `${c.count} photo${c.count === 1 ? '' : 's'}`)),
        h('span', { class: c.draft ? 'chip' : 'chip live' }, c.draft ? 'Hidden' : 'Live'))));
    } catch (e) { list.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function editGallery(slug) {
    const isNew = !slug;
    const today = new Date().toISOString().slice(0, 10);
    let c = { title: '', description: '', date: today, draft: false, cover: '', photos: [] };
    if (slug) {
      mount(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Opening…')));
      try { c = { ...c, ...(await api(`/api/content/gallery/${slug}`)).data }; c.date = (c.date || today).slice(0, 10); c.photos = (c.photos || []).map((p) => ({ ...p })); }
      catch (e) { toast(e.message, 'bad'); return gallery(); }
    }
    let address = slug || '';
    const removed = [];                           // existing photos taken out of the collection (their files get deleted on save)
    let coverPhoto = c.photos.find((p) => p.src === c.cover) || null;
    const st = guard();
    const status = h('span', { class: 'status' }, isNew ? 'New collection' : 'Saved');
    const dirty = () => { st.dirty = true; status.textContent = 'Unsaved changes'; status.className = 'status dirty'; };

    const title = h('input', { class: 'title-input', value: c.title, placeholder: 'Collection title' });
    const addr = h('input', { value: address, placeholder: 'collection-address', disabled: !isNew });
    title.oninput = () => { c.title = title.value; if (isNew) addr.value = address = slugify(c.title); dirty(); };
    addr.oninput = () => { address = slugify(addr.value); dirty(); };
    const date = h('input', { type: 'date', value: c.date }); date.onchange = () => { c.date = date.value; dirty(); };
    const desc = ta(c.description, 'A line or two about this collection (optional).', 2); desc.oninput = () => { c.description = desc.value; textGrow(desc); dirty(); };
    const hidden = h('input', { type: 'checkbox' }); hidden.checked = !!c.draft; hidden.onchange = () => { c.draft = hidden.checked; dirty(); };

    // ---- photo tiles ----
    const grid = h('div', { class: 'gal-grid' });
    const counter = h('div', { class: 'muted small' });
    const photoUrl = (p) => (p._new ? p._new.url : p.thumb);
    const paint = () => {
      counter.textContent = `${c.photos.length} photo${c.photos.length === 1 ? '' : 's'}${coverPhoto ? '' : ' · the first photo is the cover'}`;
      grid.replaceChildren(...c.photos.map((p, i) => {
        const n = p._new;
        const busy = n && n.status !== 'done';
        const tile = h('div', { class: `gal-tile${coverPhoto === p ? ' is-cover' : ''}`, draggable: busy ? 'false' : 'true' });
        tile.append(
          h('div', { class: 'gal-img', style: `background-image:url("${photoUrl(p)}")` }, busy ? h('div', { class: 'gal-busy' }, n.status === 'error' ? 'Failed' : 'Uploading…') : null),
          h('div', { class: 'gal-tools' },
            h('button', { class: 'ghost', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => move(i, -1) }, '←'),
            h('button', { class: 'ghost', 'aria-label': 'Move later', disabled: i === c.photos.length - 1, onclick: () => move(i, 1) }, '→'),
            h('button', { class: 'ghost', 'aria-label': 'Use as cover', 'aria-pressed': String(coverPhoto === p), title: 'Use as cover', onclick: () => { coverPhoto = p; paint(); dirty(); } }, '★'),
            h('button', { class: 'ghost danger', 'aria-label': 'Remove photo', onclick: () => removePhoto(i) }, '✕')),
          h('input', { class: 'gal-cap', value: p.caption || '', placeholder: 'Caption', oninput: (e) => { p.caption = e.target.value; dirty(); } }));
        if (n?.status === 'error') tile.append(h('button', { class: 'small', onclick: () => { n.status = 'queued'; paint(); pump(); } }, 'Retry upload'));
        // drag to reorder on a computer
        tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; tile.classList.add('drag'); });
        tile.addEventListener('dragend', () => tile.classList.remove('drag'));
        tile.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        tile.addEventListener('drop', (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isNaN(from) || from === i) return; const [m] = c.photos.splice(from, 1); c.photos.splice(i, 0, m); paint(); dirty(); });
        return tile;
      }));
    };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= c.photos.length) return; [c.photos[i], c.photos[j]] = [c.photos[j], c.photos[i]]; paint(); dirty(); };
    const removePhoto = (i) => {
      const [p] = c.photos.splice(i, 1);
      if (!p._new) removed.push(p);
      if (coverPhoto === p) coverPhoto = null;
      paint(); dirty();
    };

    // ---- adding photos: resize on this device, then upload each file in the background (no rebuild until you save) ----
    let active = 0;
    const upload = async (blob) => (await api('/api/content/blob', { method: 'POST', body: { base64: await toBase64(blob) } })).sha;
    const pump = () => {
      for (const p of c.photos) {
        const n = p._new;
        if (!n || n.status !== 'queued' || active >= 2) continue;
        n.status = 'uploading'; active++;
        (async () => {
          try { n.fullSha = n.fullSha || await upload(n.fullBlob); n.thumbSha = n.thumbSha || await upload(n.thumbBlob); n.status = 'done'; n.fullBlob = n.thumbBlob = null; }
          catch (e) { n.status = 'error'; toast(`A photo didn't upload: ${e.message}`, 'bad'); }
          finally { active--; paint(); pump(); }
        })();
      }
    };
    const add = h('button', {}, '+ Add photos');
    add.onclick = async () => {
      const filesPicked = await chooseFiles(true);
      if (!filesPicked.length) return;
      if (c.photos.length + filesPicked.length > 600) return toast('A collection can hold up to 600 photos.', 'bad');
      let done = 0;
      for (const file of filesPicked) {
        toast(`Preparing photo ${++done} of ${filesPicked.length}…`);
        try {
          const { full, thumb } = await processPhoto(file);
          const base = `${slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 30)}-${Date.now().toString(36)}${done}`;
          c.photos.push({ w: full.w, h: full.h, caption: '', _new: { name: `${base}.${full.ext}`, thumbName: `${base}-t.${thumb.ext}`, url: URL.createObjectURL(thumb.blob), fullBlob: full.blob, thumbBlob: thumb.blob, status: 'queued' } });
          paint(); pump(); dirty();
        } catch { toast(`Couldn't read “${file.name}”.`, 'bad'); }
      }
    };

    // ---- save ----
    const save = h('button', { class: 'primary' }, 'Save to site');
    save.onclick = async () => {
      if (!c.title.trim()) return toast('Give the collection a title.', 'bad');
      if (!address) return toast('The address is empty.', 'bad');
      if (c.photos.some((p) => p._new?.status === 'error')) return toast('Some photos failed to upload. Retry or remove them.', 'bad');
      save.disabled = true;
      try {
        while (c.photos.some((p) => p._new && p._new.status !== 'done')) {
          const left = c.photos.filter((p) => p._new && p._new.status !== 'done').length;
          status.textContent = `Uploading photos… ${left} left`;
          await new Promise((r) => setTimeout(r, 400));
          if (c.photos.some((p) => p._new?.status === 'error')) throw new Error('Some photos failed to upload. Retry or remove them.');
        }
        status.textContent = 'Saving…';
        const base = `/uploads/gallery/${address}`;
        const photos = c.photos.map((p) => p._new
          ? { src: `${base}/${p._new.name}`, thumb: `${base}/${p._new.thumbName}`, w: p.w, h: p.h, ...(p.caption ? { caption: p.caption } : {}) }
          : { src: p.src, thumb: p.thumb, w: p.w, h: p.h, ...(p.caption ? { caption: p.caption } : {}), ...(p.alt ? { alt: p.alt } : {}) });
        const idx = coverPhoto ? c.photos.indexOf(coverPhoto) : -1;
        const data = { title: c.title.trim(), description: c.description.trim(), date: c.date, draft: !!c.draft, cover: idx >= 0 ? photos[idx].src : '', photos };
        const newFiles = c.photos.filter((p) => p._new).flatMap((p) => [{ path: `public${base}/${p._new.name}`, sha: p._new.fullSha }, { path: `public${base}/${p._new.thumbName}`, sha: p._new.thumbSha }]);
        const deleteFiles = removed.flatMap((p) => [`public${p.src}`, `public${p.thumb}`]);
        await api(`/api/content/gallery/${address}`, { method: 'PUT', body: { data, newFiles, deleteFiles, isNew } });
        // the saved photos are now plain (already stored) photos
        c.photos = photos.map((p, i) => ({ ...p })); coverPhoto = idx >= 0 ? c.photos[idx] : null; removed.length = 0;
        st.dirty = false; status.textContent = 'Saved'; status.className = 'status'; addr.disabled = true; paint(); toast(SAVED, 'good');
      } catch (e) { status.textContent = 'Not saved'; status.className = 'status dirty'; toast(e.message, 'bad'); }
      finally { save.disabled = false; }
    };
    const del = isNew ? null : h('button', { class: 'ghost danger small', onclick: async () => {
      if (!confirm(`Delete the collection “${c.title}” and all ${c.photos.length} photos in it? This removes them from the site.`)) return;
      try { await api(`/api/content/gallery/${address}`, { method: 'DELETE' }); st.dirty = false; window.onbeforeunload = null; toast('Collection deleted.', 'good'); gallery(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Delete collection');

    mount(h('div', { class: 'wrap' }, h('div', { class: 'topbar' }, h('button', { class: 'ghost', onclick: leave(st, gallery) }, '← Gallery'), h('div', { class: 'savebar' }, status, save)),
      h('div', { class: 'card meta' }, title, h('div', { class: 'two' }, field('Date', date), field('Web address', addr)), field('Description', desc),
        h('label', { class: 'row', style: 'gap:10px;font-size:.95rem;flex-wrap:nowrap;align-items:center' }, hidden, 'Hide this collection from the site (draft)')),
      h('div', { class: 'row', style: 'margin:18px 0 10px;justify-content:space-between' }, h('div', { class: 'row' }, add, counter),
        h('span', { class: 'muted small' }, 'Drag to reorder, or use the arrows. ★ sets the cover.')),
      grid, del ? h('div', { style: 'margin-top:28px' }, del) : null));
    paint();
  }

  return { gallery, projects, skills, home };
}
