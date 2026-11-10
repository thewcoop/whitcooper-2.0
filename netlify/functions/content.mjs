// Edit the rest of the site from Studio: home page text, projects and skills.
// Routes: /api/content/home, /api/content/projects[/:slug], /api/content/skills[/:slug]
// Everything is validated here so a mistake in the editor can never produce a file that breaks the site build.
import { json, readJson } from '../lib/http.mjs';
import { isAuthed } from '../lib/session.mjs';
import { listDir, readFile, commitFiles, createBlob, branchFor, UPLOADS_DIR } from '../lib/github.mjs';

export const config = { path: '/api/content/*' };

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp|gif|avif)$/;
const MAX_FILE_B64 = 7_000_000;
const TAGS = ['Editing', 'Motion Graphics', 'VFX', 'Color', 'Sound Design'];
const HOME_PATH = 'src/content/home/homepage.json';
const SKILLS_DIR = 'src/content/skills';
const PROJECTS_DIR = 'src/content/portfolio';
const GALLERY_DIR = 'src/content/gallery';
const GALLERY_IMG_DIR = `${UPLOADS_DIR}/gallery`;
const SHA = /^[0-9a-f]{40}$/;
const MAX_PHOTOS = 600;

class Bad extends Error {}
const bad = (msg) => { throw new Bad(msg); };
const str = (v, max, label, { required = false } = {}) => {
  if (v == null || v === '') { if (required) bad(`${label} can't be empty.`); return ''; }
  if (typeof v !== 'string') bad(`${label} must be text.`);
  if (v.length > max) bad(`${label} is too long (max ${max} characters).`);
  return v;
};

// ---- project files are markdown with YAML frontmatter: check the few fields the site depends on
function validateProject(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('---\n')) bad('Project is missing its content.');
  const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [])[1];
  if (!fm) bad('Project is missing its details.');
  if (!/^title:\s*\S/m.test(fm)) bad('Project needs a title.');
  if (!/^videoURL:\s*\S/m.test(fm)) bad('Project needs a video link.');
  const tagBlock = (fm.match(/^tags:\s*\n((?:\s+-\s.*\n?)*)/m) || [, ''])[1];
  const tags = [...tagBlock.matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim());
  if (!tags.length) bad('Pick at least one tag.');
  for (const t of tags) if (!TAGS.includes(t)) bad(`"${t}" isn't an allowed tag.`);
}
function projectSummary(slug, raw) {
  const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
  const field = (k) => ((fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [, ''])[1] || '').trim().replace(/^["']|["']$/g, '');
  const tagBlock = (fm.match(/^tags:\s*\n((?:\s+-\s.*\n?)*)/m) || [, ''])[1];
  return { slug, title: field('title'), thumbnail: field('thumbnail'), tags: [...tagBlock.matchAll(/^\s+-\s+"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim()) };
}

function cleanSkill(d) {
  if (!d || typeof d !== 'object') bad('Skill is missing its details.');
  const out = { name: str(d.name, 60, 'Name', { required: true }), pov: str(d.pov, 600, 'Description', { required: true }) };
  if (d.order != null && d.order !== '') {
    const n = Number(d.order);
    if (!Number.isFinite(n) || n < 0 || n > 999) bad('Order must be a number from 0 to 999.');
    out.order = n;
  }
  const hl = Array.isArray(d.highlights) ? d.highlights : [];
  if (hl.length > 8) bad('A skill can have at most 8 highlights.');
  out.highlights = hl.map((h) => ({ item: str(typeof h === 'string' ? h : h?.item, 120, 'Highlight', { required: true }) }));
  return out;
}

// ---- gallery collections: JSON listing photos stored under public/uploads/gallery/<slug>/
const photoPath = (slug) => new RegExp(`^/uploads/gallery/${slug}/[a-z0-9][a-z0-9._-]{0,100}\\.(webp|jpe?g|png)$`);
const repoPath = (slug) => new RegExp(`^${GALLERY_IMG_DIR}/${slug}/[a-z0-9][a-z0-9._-]{0,100}\\.(webp|jpe?g|png)$`);
function cleanGallery(slug, d) {
  if (!d || typeof d !== 'object') bad('Collection is missing its details.');
  const ok = photoPath(slug);
  const out = { title: str(d.title, 80, 'Title', { required: true }), description: str(d.description, 600, 'Description'), date: str(d.date, 40, 'Date') };
  if (d.cover) { if (!ok.test(d.cover)) bad('The cover photo is not part of this collection.'); out.cover = d.cover; }
  if (d.draft) out.draft = true;
  const photos = Array.isArray(d.photos) ? d.photos : [];
  if (photos.length > MAX_PHOTOS) bad(`A collection can hold up to ${MAX_PHOTOS} photos.`);
  const int = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 12000) bad(`${label} must be a whole number.`); return n; };
  out.photos = photos.map((p, i) => {
    if (!p || !ok.test(p.src || '') || !ok.test(p.thumb || '')) bad(`Photo ${i + 1} has an invalid file.`);
    const o = { src: p.src, thumb: p.thumb, w: int(p.w, 'Photo width'), h: int(p.h, 'Photo height') };
    if (p.caption) o.caption = str(p.caption, 200, 'Caption');
    if (p.alt) o.alt = str(p.alt, 200, 'Alt text');
    return o;
  });
  if (out.cover && !out.photos.some((p) => p.src === out.cover)) delete out.cover;
  return out;
}

export default async (req) => {
  if (!isAuthed(req)) return json({ error: 'Please sign in.' }, 401);
  if (!process.env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN is not set.' }, 503);

  const b = branchFor(req);
  const [collection, slug] = new URL(req.url).pathname.replace(/^\/api\/content\//, '').replace(/\/$/, '').split('/');
  if (slug && !SLUG.test(slug)) return json({ error: 'Invalid address.' }, 400);

  try {
    // ---------- home page ----------
    if (collection === 'home' && !slug) {
      if (req.method === 'GET') {
        const f = await readFile(HOME_PATH, b);
        return json({ data: JSON.parse(f.raw) });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        const d = body?.data || {};
        const featured = Array.isArray(d.featured) ? d.featured : [];
        if (featured.length > 3 || featured.some((s) => !SLUG.test(s))) bad('Pick up to three projects.');
        const current = JSON.parse((await readFile(HOME_PATH, b)).raw);
        const next = { ...current, tagline: str(d.tagline, 120, 'Tagline'), intro: str(d.intro, 1500, 'Intro'), featured: [...new Set(featured)] };
        await commitFiles('Update home page via Studio', [{ path: HOME_PATH, content: JSON.stringify(next, null, 2) + '\n' }], b);
        return json({ ok: true });
      }
    }

    // ---------- skills ----------
    if (collection === 'skills') {
      if (!slug && req.method === 'GET') {
        const files = await listDir(SKILLS_DIR, b, /\.json$/);
        const items = await Promise.all(files.map(async (f) => ({ slug: f.name.replace(/\.json$/, ''), ...JSON.parse((await readFile(f.path, b)).raw) })));
        items.sort((x, y) => (x.order ?? 999) - (y.order ?? 999) || x.slug.localeCompare(y.slug));
        return json({ skills: items });
      }
      const path = `${SKILLS_DIR}/${slug}.json`;
      if (slug && req.method === 'GET') return json({ slug, data: JSON.parse((await readFile(path, b)).raw) });
      if (slug && req.method === 'PUT') {
        const body = await readJson(req);
        const data = cleanSkill(body?.data);
        await commitFiles(`${body?.isNew ? 'Add' : 'Update'} skill "${data.name}" via Studio`, [{ path, content: JSON.stringify(data, null, 2) + '\n' }], b);
        return json({ ok: true, slug });
      }
      if (slug && req.method === 'DELETE') {
        await commitFiles(`Delete skill "${slug}" via Studio`, [{ path, delete: true }], b);
        return json({ ok: true });
      }
    }

    // ---------- projects (the portfolio) ----------
    if (collection === 'projects') {
      if (!slug && req.method === 'GET') {
        const files = await listDir(PROJECTS_DIR, b, /\.md$/);
        const items = await Promise.all(files.map(async (f) => projectSummary(f.name.replace(/\.md$/, ''), (await readFile(f.path, b)).raw)));
        return json({ projects: items });
      }
      const path = `${PROJECTS_DIR}/${slug}.md`;
      if (slug && req.method === 'GET') return json({ slug, ...(await readFile(path, b)) });
      if (slug && req.method === 'PUT') {
        const body = await readJson(req);
        validateProject(body?.raw);
        const files = [{ path, content: body.raw }];
        for (const img of body.files || []) {
          if (!IMAGE_NAME.test(img.name || '') || typeof img.base64 !== 'string' || img.base64.length > MAX_FILE_B64) bad(`Photo "${img.name}" was rejected (type or size).`);
          files.push({ path: `${UPLOADS_DIR}/${img.name}`, base64: img.base64 });
        }
        await commitFiles(`${body.isNew ? 'Add' : 'Update'} project "${slug}" via Studio`, files, b);
        return json({ ok: true, slug });
      }
      if (slug && req.method === 'DELETE') {
        await commitFiles(`Delete project "${slug}" via Studio`, [{ path, delete: true }], b);
        return json({ ok: true });
      }
    }
    // ---------- photo upload (no commit, no rebuild) ----------
    if (collection === 'blob' && !slug && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body?.base64 !== 'string' || !body.base64 || body.base64.length > MAX_FILE_B64) bad('That photo is too large or empty.');
      return json({ sha: await createBlob(body.base64) });
    }

    // ---------- gallery ----------
    if (collection === 'gallery') {
      if (!slug && req.method === 'GET') {
        const files = await listDir(GALLERY_DIR, b, /\.json$/).catch((e) => (e.status === 404 ? [] : Promise.reject(e)));
        const items = await Promise.all(files.map(async (f) => {
          const d = JSON.parse((await readFile(f.path, b)).raw);
          const cover = (d.photos || []).find((p) => p.src === d.cover) || (d.photos || [])[0];
          return { slug: f.name.replace(/\.json$/, ''), title: d.title, date: d.date || '', draft: !!d.draft, count: (d.photos || []).length, coverThumb: cover?.thumb || '' };
        }));
        items.sort((x, y) => new Date(y.date) - new Date(x.date));
        return json({ collections: items });
      }
      const path = `${GALLERY_DIR}/${slug}.json`;
      if (slug && req.method === 'GET') return json({ slug, data: JSON.parse((await readFile(path, b)).raw) });
      if (slug && req.method === 'PUT') {
        const body = await readJson(req);
        const data = cleanGallery(slug, body?.data);
        const rp = repoPath(slug);
        const files = [{ path, content: JSON.stringify(data, null, 2) + '\n' }];
        for (const f of body.newFiles || []) {
          if (!rp.test(f?.path || '') || !SHA.test(f?.sha || '')) bad('One of the photos was rejected.');
          files.push({ path: f.path, sha: f.sha });
        }
        for (const p of body.deleteFiles || []) {
          if (!rp.test(p || '')) bad('Cannot delete that file.');
          files.push({ path: p, delete: true });
        }
        await commitFiles(`${body.isNew ? 'Add' : 'Update'} gallery "${data.title}" via Studio`, files, b);
        return json({ ok: true, slug });
      }
      if (slug && req.method === 'DELETE') {
        const imgs = await listDir(`${GALLERY_IMG_DIR}/${slug}`, b).catch((e) => (e.status === 404 ? [] : Promise.reject(e)));
        await commitFiles(`Delete gallery "${slug}" via Studio`, [{ path, delete: true }, ...imgs.map((f) => ({ path: f.path, delete: true }))], b);
        return json({ ok: true });
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof Bad) return json({ error: err.message }, 400);
    console.error('[content]', err.message);
    const status = err.status === 404 ? 404 : 502;
    return json({ error: status === 404 ? 'Not found.' : err.message }, status);
  }
};
