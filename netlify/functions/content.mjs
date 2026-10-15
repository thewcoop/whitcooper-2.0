// Edit the rest of the site from Studio: home page text, projects and skills.
// Routes: /api/content/home, /api/content/projects[/:slug], /api/content/skills[/:slug]
// Everything is validated here so a mistake in the editor can never produce a file that breaks the site build.
import { json, readJson } from '../lib/http.mjs';
import { isAuthed } from '../lib/session.mjs';
import { listDir, readFile, commitFiles, branchFor, UPLOADS_DIR } from '../lib/github.mjs';

export const config = { path: '/api/content/*' };

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp|gif|avif)$/;
const MAX_FILE_B64 = 7_000_000;
const TAGS = ['Editing', 'Motion Graphics', 'VFX', 'Color', 'Sound Design'];
const HOME_PATH = 'src/content/home/homepage.json';
const SKILLS_DIR = 'src/content/skills';
const PROJECTS_DIR = 'src/content/portfolio';

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
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof Bad) return json({ error: err.message }, 400);
    console.error('[content]', err.message);
    const status = err.status === 404 ? 404 : 502;
    return json({ error: status === 404 ? 'Not found.' : err.message }, status);
  }
};
