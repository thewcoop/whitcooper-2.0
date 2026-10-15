// Studio screens for the rest of the site: projects, skills and the home page.
// Each screen reads and saves through /api/content (see netlify/functions/content.mjs).
import { splitFile } from './post-format.js';

const TAGS = ['Editing', 'Motion Graphics', 'VFX', 'Color', 'Sound Design'];

export function makeSite(ctx) {
  const { h, api, mount, toast, pickPhotos, imgUrl, pending, slugify, tabs, textGrow } = ctx;
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

  return { projects, skills, home };
}
