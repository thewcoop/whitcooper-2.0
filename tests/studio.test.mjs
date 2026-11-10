// Studio backend checks. Run with: npm run test:studio
// Uses a pretend GitHub, so nothing real is touched. Covers posts, projects, skills, the home page and the gallery.
import http from 'node:http';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url).pathname;

// ---------- pretend GitHub ----------
const files = {
  'src/content/blog/hello.md': '---\ntitle: "Hello"\ndate: "2026-01-01T00:00:00-06:00"\ndraft: true\n---\nHi\n',
  'src/content/home/homepage.json': JSON.stringify({ tagline: 'T', intro: 'I', featured: ['a'], legacy: 'keep-me' }),
  'src/content/skills/01-editing.json': JSON.stringify({ name: 'Editing', pov: 'p', highlights: [{ item: 'x' }] }),
  'src/content/skills/02-color.json': JSON.stringify({ name: 'Color', pov: 'q', order: 0, highlights: [] }),
  'src/content/portfolio/p1.md': '---\ntitle: P1\nvideoURL: https://vimeo.com/1\ntags:\n  - Editing\n  - Color\nthumbnail: /uploads/a.webp\n---\n',
  'src/content/gallery/tokyo.json': JSON.stringify({ title: 'Tokyo', date: '2026-03-04', cover: '/uploads/gallery/tokyo/a.webp', photos: [
    { src: '/uploads/gallery/tokyo/a.webp', thumb: '/uploads/gallery/tokyo/a-t.webp', w: 1600, h: 1000 },
    { src: '/uploads/gallery/tokyo/b.webp', thumb: '/uploads/gallery/tokyo/b-t.webp', w: 1000, h: 1500 }] }),
  'public/uploads/gallery/tokyo/a.webp': 'x', 'public/uploads/gallery/tokyo/a-t.webp': 'x',
  'public/uploads/gallery/tokyo/b.webp': 'x', 'public/uploads/gallery/tokyo/b-t.webp': 'x',
};
const blobs = new Map();
const log = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = req.url.replace('/repos/x/y', '');
  const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers.authorization !== 'Bearer tok') return send({ message: 'Bad credentials' }, 401);
  let m;
  if ((m = u.match(/^\/contents\/(.+?)\?ref=(.+)$/))) {
    const path = m[1];
    if (files[path] != null) return send({ sha: 's', content: Buffer.from(files[path]).toString('base64') });
    const kids = Object.keys(files).filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
    return kids.length ? send(kids.map((k) => ({ type: 'file', name: k.split('/').pop(), path: k }))) : send({ message: 'Not Found' }, 404);
  }
  if (u.startsWith('/git/refs/heads/')) { if (req.method === 'GET') return send({ object: { sha: 'tip' } }); log.push({ patch: u.split('/').pop() }); return send({}); }
  if (u === '/git/commits/tip') return send({ tree: { sha: 't0' } });
  if (u === '/git/blobs') { const b = JSON.parse(body); const sha = String(blobs.size).padStart(40, '0'); blobs.set(sha, b.encoding === 'base64' ? Buffer.from(b.content, 'base64').toString('utf8') : b.content); return send({ sha }); }
  if (u === '/git/trees') { log.push({ tree: JSON.parse(body).tree }); return send({ sha: 't1' }); }
  if (u === '/git/commits' && req.method === 'POST') { log.push({ commit: JSON.parse(body).message }); return send({ sha: 'c1' }); }
  send({ message: 'nope ' + u }, 404);
});
await new Promise((r) => mock.listen(0, r));
Object.assign(process.env, { STUDIO_STORE: 'memory', GITHUB_REPO: 'x/y', GITHUB_API_URL: `http://127.0.0.1:${mock.address().port}`, SESSION_SECRET: 'unit-test-secret-unit-test-secret', GITHUB_TOKEN: 'tok', SETUP_CODE: 'c' });
delete process.env.GITHUB_BRANCH;

const { default: content } = await import(root + 'netlify/functions/content.mjs');
const { default: posts } = await import(root + 'netlify/functions/posts.mjs');
const { makeToken } = await import(root + 'netlify/lib/session.mjs');
const cookie = 'studio_session=' + makeToken(process.env.SESSION_SECRET, { role: 'owner' }, 600);
const call = (fn, path, { method = 'GET', body, auth = true, host = 'whitcooper.com' } = {}) =>
  fn(new Request(`https://${host}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
const lastTree = () => [...log].reverse().find((l) => l.tree).tree;
const blobText = (sha) => blobs.get(sha);
let passed = 0;
const pass = (n) => { passed++; console.log('  PASS', n); };
const section = (n) => console.log('\n' + n);
const SHA = 'b'.repeat(40);
const photo = (slug, n, extra = {}) => ({ src: `/uploads/gallery/${slug}/${n}.webp`, thumb: `/uploads/gallery/${slug}/${n}-t.webp`, w: 1200, h: 800, ...extra });

section('POSTS');
assert.equal((await call(posts, '/api/posts', { auth: false })).status, 401); pass('needs sign-in');
let j = await (await call(posts, '/api/posts')).json(); assert.equal(j.posts[0].slug, 'hello'); assert.equal(j.posts[0].draft, true); pass('lists posts with draft flag');
assert.equal((await call(posts, '/api/posts/..%2Fetc')).status, 400); pass('rejects unsafe addresses');
assert.equal((await call(posts, '/api/posts/nope')).status, 404); pass('missing post is 404');
log.length = 0;
let r = await call(posts, '/api/posts/new-post', { method: 'PUT', body: { raw: '---\ntitle: "T"\n---\nBody\n', isNew: true, files: [{ name: 'pic-1.webp', base64: 'QUJD' }] } });
assert.equal(r.status, 200); assert.deepEqual(lastTree().map((t) => t.path), ['src/content/blog/new-post.md', 'public/uploads/pic-1.webp']); assert.equal(log.filter((l) => l.commit).length, 1); pass('post and photo save in ONE commit');
assert.equal((await call(posts, '/api/posts/x', { method: 'PUT', body: { raw: '---\n---\n', files: [{ name: '../../evil.js', base64: 'QQ==' }] } })).status, 400); pass('rejects malicious upload names');

section('HOME PAGE');
j = await (await call(content, '/api/content/home')).json(); assert.equal(j.data.tagline, 'T'); pass('reads home');
r = await call(content, '/api/content/home', { method: 'PUT', body: { data: { tagline: 'New', intro: 'Hello **x**', featured: ['p1', 'p1', 'p2'] } } }); assert.equal(r.status, 200);
const home = JSON.parse(blobText(lastTree()[0].sha)); assert.deepEqual(home.featured, ['p1', 'p2']); assert.equal(home.legacy, 'keep-me'); assert.equal(home.tagline, 'New'); pass('saves home, dedupes picks, keeps unknown keys');
for (const [label, data] of [['more than three picks', { tagline: 'x', intro: 'y', featured: ['a', 'b', 'c', 'd'] }], ['over-long tagline', { tagline: 'x'.repeat(500), intro: '', featured: [] }], ['unsafe slugs', { tagline: 'x', intro: 'y', featured: ['../x'] }]]) {
  assert.equal((await call(content, '/api/content/home', { method: 'PUT', body: { data } })).status, 400); pass('rejects ' + label);
}

section('SKILLS');
j = await (await call(content, '/api/content/skills')).json(); assert.deepEqual(j.skills.map((s) => s.slug), ['02-color', '01-editing']); pass('lists skills by order');
r = await call(content, '/api/content/skills/sound', { method: 'PUT', body: { isNew: true, data: { name: 'Sound', pov: 'Loud', order: 3, highlights: [{ item: 'a' }, { item: 'b' }] } } }); assert.equal(r.status, 200);
const sk = JSON.parse(blobText(lastTree()[0].sha)); assert.equal(sk.order, 3); assert.equal(sk.highlights.length, 2); pass('saves a skill');
assert.equal((await call(content, '/api/content/skills/x', { method: 'PUT', body: { data: { name: '', pov: 'p' } } })).status, 400); pass('rejects empty name');
assert.equal((await call(content, '/api/content/skills/x', { method: 'PUT', body: { data: { name: 'a', pov: 'p', order: 'abc' } } })).status, 400); pass('rejects non-numeric order');
await call(content, '/api/content/skills/01-editing', { method: 'DELETE' }); assert.equal(lastTree()[0].sha, null); pass('deletes a skill');

section('PROJECTS');
j = await (await call(content, '/api/content/projects')).json(); assert.deepEqual(j.projects[0], { slug: 'p1', title: 'P1', thumbnail: '/uploads/a.webp', tags: ['Editing', 'Color'] }); pass('lists projects');
const goodRaw = '---\ntitle: "T"\nvideoURL: "https://vimeo.com/2"\ntags:\n  - VFX\ndescription: "d"\n---\n';
r = await call(content, '/api/content/projects/new-p', { method: 'PUT', body: { raw: goodRaw, isNew: true, files: [{ name: 'thumb-1.webp', base64: 'QUJD' }] } });
assert.equal(r.status, 200); assert.deepEqual(lastTree().map((t) => t.path), ['src/content/portfolio/new-p.md', 'public/uploads/thumb-1.webp']); pass('saves project and thumbnail in one commit');
for (const [label, raw] of [['a tag the site does not allow', goodRaw.replace('VFX', 'Magic')], ['no video link', goodRaw.replace(/videoURL:.*\n/, '')], ['no tags', goodRaw.replace('  - VFX\n', '')]]) {
  assert.equal((await call(content, '/api/content/projects/x', { method: 'PUT', body: { raw } })).status, 400); pass('rejects ' + label);
}

section('GALLERY');
assert.equal((await call(content, '/api/content/blob', { method: 'POST', body: { base64: 'QUJD' }, auth: false })).status, 401); pass('photo upload needs sign-in');
log.length = 0;
r = await call(content, '/api/content/blob', { method: 'POST', body: { base64: 'QUJD' } }); j = await r.json(); assert.equal(r.status, 200); assert.ok(j.sha); assert.ok(!log.some((l) => l.commit)); pass('photo upload makes no commit (so no rebuild)');
assert.equal((await call(content, '/api/content/blob', { method: 'POST', body: { base64: '' } })).status, 400); pass('rejects an empty upload');
assert.equal((await call(content, '/api/content/blob', { method: 'POST', body: { base64: 'A'.repeat(7_000_001) } })).status, 400); pass('rejects an oversized upload');
j = await (await call(content, '/api/content/gallery')).json(); assert.deepEqual(j.collections, [{ slug: 'tokyo', title: 'Tokyo', date: '2026-03-04', draft: false, count: 2, coverThumb: '/uploads/gallery/tokyo/a-t.webp' }]); pass('lists collections with count and cover thumbnail');
assert.equal((await (await call(content, '/api/content/gallery/tokyo')).json()).data.photos.length, 2); pass('reads one collection');

log.length = 0;
r = await call(content, '/api/content/gallery/summer', { method: 'PUT', body: { isNew: true, data: { title: 'Summer', description: 'd', date: '2026-07-01', draft: true, cover: '/uploads/gallery/summer/p1.webp', photos: [photo('summer', 'p1', { caption: 'hi' }), photo('summer', 'p2')] },
  newFiles: ['p1', 'p1-t', 'p2', 'p2-t'].map((n) => ({ path: `public/uploads/gallery/summer/${n}.webp`, sha: SHA })) } });
assert.equal(r.status, 200, await r.clone().text());
let tree = lastTree(); assert.equal(tree.length, 5); assert.equal(tree[0].path, 'src/content/gallery/summer.json'); assert.ok(tree.slice(1).every((x) => x.sha === SHA)); assert.equal(log.filter((l) => l.commit).length, 1); pass('saves a collection and its photos in ONE commit');
const saved = JSON.parse(blobText(tree[0].sha)); assert.equal(saved.title, 'Summer'); assert.equal(saved.draft, true); assert.equal(saved.cover, '/uploads/gallery/summer/p1.webp'); assert.equal(saved.photos.length, 2); assert.equal(saved.photos[0].caption, 'hi'); pass('the saved collection file has the right contents');

log.length = 0;
r = await call(content, '/api/content/gallery/tokyo', { method: 'PUT', body: { data: { title: 'Tokyo', photos: [photo('tokyo', 'a')], cover: '/uploads/gallery/tokyo/zzz.webp' }, deleteFiles: ['public/uploads/gallery/tokyo/b.webp', 'public/uploads/gallery/tokyo/b-t.webp'] } });
assert.equal(r.status, 200); tree = lastTree();
assert.deepEqual(tree.filter((x) => x.sha === null).map((x) => x.path), ['public/uploads/gallery/tokyo/b.webp', 'public/uploads/gallery/tokyo/b-t.webp']); pass('removing photos also deletes their files');
assert.equal(JSON.parse(blobText(tree[0].sha)).cover, undefined); pass('a cover that is not in the collection is dropped');

const bad = async (label, slug, body) => { assert.equal((await call(content, `/api/content/gallery/${slug}`, { method: 'PUT', body })).status, 400, label); pass('rejects ' + label); };
await bad('a missing title', 'x', { data: { title: '', photos: [] } });
await bad('a photo from another collection', 'x', { data: { title: 'X', photos: [photo('other', 'p1')] } });
await bad('path tricks in a photo path', 'x', { data: { title: 'X', photos: [{ ...photo('x', 'p1'), src: '/uploads/gallery/x/../../secret.webp' }] } });
await bad('a non-numeric photo size', 'x', { data: { title: 'X', photos: [photo('x', 'p1', { w: 'wide' })] } });
await bad('more than 600 photos', 'x', { data: { title: 'X', photos: Array.from({ length: 601 }, (_, i) => photo('x', 'p' + i)) } });
await bad('an uploaded file with a bad id', 'x', { data: { title: 'X', photos: [] }, newFiles: [{ path: 'public/uploads/gallery/x/p1.webp', sha: 'nothex' }] });
await bad('an uploaded file outside its collection folder', 'x', { data: { title: 'X', photos: [] }, newFiles: [{ path: 'public/uploads/other/p1.webp', sha: SHA }] });
await bad('deleting files outside the collection folder', 'x', { data: { title: 'X', photos: [] }, deleteFiles: ['src/content/blog/hello.md'] });
await bad('a non-image file name', 'x', { data: { title: 'X', photos: [] }, newFiles: [{ path: 'public/uploads/gallery/x/run.js', sha: SHA }] });

log.length = 0;
assert.equal((await call(content, '/api/content/gallery/tokyo', { method: 'DELETE' })).status, 200);
assert.deepEqual(lastTree().map((x) => x.path).sort(), ['public/uploads/gallery/tokyo/a-t.webp', 'public/uploads/gallery/tokyo/a.webp', 'public/uploads/gallery/tokyo/b-t.webp', 'public/uploads/gallery/tokyo/b.webp', 'src/content/gallery/tokyo.json']);
assert.ok(lastTree().every((x) => x.sha === null)); pass('deleting a collection removes its file and all its photos');

section('PREVIEW BRANCHES');
log.length = 0;
await call(content, '/api/content/home', { method: 'PUT', body: { data: { tagline: 'p', intro: 'p', featured: [] } }, host: 'gallery--whitcooper.netlify.app' });
assert.ok(log.some((l) => l.patch === 'gallery') && !log.some((l) => l.patch === 'main')); pass('a preview address saves to its own branch, not main');
log.length = 0;
await call(content, '/api/content/home', { method: 'PUT', body: { data: { tagline: 'p', intro: 'p', featured: [] } } });
assert.ok(log.some((l) => l.patch === 'main')); pass('the real domain saves to main');
log.length = 0;
await call(posts, '/api/posts/hello', { method: 'PUT', body: { raw: '---\ntitle: "x"\n---\nhi\n' }, host: 'studio-admin--whitcooper.netlify.app' });
assert.ok(log.some((l) => l.patch === 'studio-admin')); pass('posts follow the preview branch too');

mock.close();
console.log(`\nALL ${passed} CHECKS PASSED`);
