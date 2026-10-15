// Read, save and delete blog posts (and their photos) in the GitHub repo.
// Routes: GET /api/posts, GET|PUT|DELETE /api/posts/:slug
import { json, readJson } from '../lib/http.mjs';
import { isAuthed } from '../lib/session.mjs';
import { listPosts, readFile, commitFiles, BLOG_DIR, UPLOADS_DIR } from '../lib/github.mjs';

export const config = { path: ['/api/posts', '/api/posts/*'] };

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}\.(jpe?g|png|webp|gif|avif)$/;
const MAX_FILE_B64 = 7_000_000;

// Pulls the few fields the post list needs out of the YAML frontmatter.
function summarize(name, raw) {
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const field = (key) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.*(?:\\n[ \\t]+.*)*)`, 'm'));
    if (!m) return '';
    return m[1].replace(/\n[ \t]+/g, ' ').trim().replace(/^["']|["']$/g, '');
  };
  return {
    slug: name.replace(/\.mdx?$/, ''),
    title: field('title'),
    date: field('date'),
    summary: field('summary'),
    coverImage: field('coverImage'),
    draft: field('draft') === 'true',
  };
}

export default async (req) => {
  if (!isAuthed(req)) return json({ error: 'Please sign in.' }, 401);
  if (!process.env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN is not set.' }, 503);

  const url = new URL(req.url);
  const slug = url.pathname.replace(/^\/api\/posts\/?/, '').replace(/\/$/, '');

  try {
    if (!slug) {
      if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const files = await listPosts();
      const posts = await Promise.all(files.map(async (f) => summarize(f.name, (await readFile(f.path)).raw)));
      posts.sort((a, b) => new Date(b.date) - new Date(a.date));
      return json({ posts });
    }

    if (!SLUG.test(slug)) return json({ error: 'Invalid post address.' }, 400);
    const path = `${BLOG_DIR}/${slug}.md`;

    if (req.method === 'GET') {
      const file = await readFile(path);
      return json({ slug, ...file });
    }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (!body || typeof body.raw !== 'string' || !body.raw.startsWith('---')) {
        return json({ error: 'Post is missing its content.' }, 400);
      }
      const files = [{ path, content: body.raw }];
      for (const img of body.files || []) {
        if (!IMAGE_NAME.test(img.name || '') || typeof img.base64 !== 'string' || img.base64.length > MAX_FILE_B64) {
          return json({ error: `Photo "${img.name}" was rejected (type or size).` }, 400);
        }
        files.push({ path: `${UPLOADS_DIR}/${img.name}`, base64: img.base64 });
      }
      const verb = body.isNew ? 'Add' : 'Update';
      await commitFiles(`${verb} post "${slug}" via Studio`, files);
      return json({ ok: true, slug });
    }

    if (req.method === 'DELETE') {
      await commitFiles(`Delete post "${slug}" via Studio`, [{ path, delete: true }]);
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('[posts]', err.message);
    const status = err.status === 404 ? 404 : 502;
    return json({ error: status === 404 ? 'Post not found.' : err.message }, status);
  }
};
