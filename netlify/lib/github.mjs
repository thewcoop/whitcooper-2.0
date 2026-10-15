// Talks to GitHub to read and commit site content. One commit can change many files,
// so publishing a post with photos triggers a single site rebuild.
const REPO = process.env.GITHUB_REPO || 'thewcoop/whitcooper-2.0';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
export const BLOG_DIR = 'src/content/blog';
export const UPLOADS_DIR = 'public/uploads';

// Which branch to read and write. On a branch preview (home-redesign--whitcooper.netlify.app) Studio
// edits that same branch, so testing never touches the live site. The real domain edits main.
export function branchFor(req) {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;
  const host = new URL(req.url).hostname;
  const m = host.match(/^([a-z0-9-]+)--[a-z0-9-]+\.netlify\.app$/);
  return m ? m[1] : 'main';
}

async function gh(path, method = 'GET', body) {
  const resp = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'whitcooper-studio',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(`GitHub ${resp.status}: ${(data.message || '').slice(0, 160)}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

export async function listDir(dir, b, extRe = /./) {
  const entries = await gh(`/contents/${dir}?ref=${b}`);
  return entries.filter((e) => e.type === 'file' && extRe.test(e.name));
}
export const listPosts = (b) => listDir(BLOG_DIR, b, /\.mdx?$/);

export async function readFile(path, b) {
  const f = await gh(`/contents/${path}?ref=${b}`);
  return { sha: f.sha, raw: Buffer.from(f.content, 'base64').toString('utf8') };
}

// files: [{ path, content (utf8 string) | base64 (string) | delete: true }]
export async function commitFiles(message, files, b) {
  const ref = await gh(`/git/refs/heads/${b}`);
  const tip = await gh(`/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    if (f.delete) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await gh('/git/blobs', 'POST', f.base64
      ? { content: f.base64, encoding: 'base64' }
      : { content: f.content, encoding: 'utf-8' });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh('/git/trees', 'POST', { base_tree: tip.tree.sha, tree });
  const commit = await gh('/git/commits', 'POST', { message, parents: [ref.object.sha], tree: newTree.sha });
  await gh(`/git/refs/heads/${b}`, 'PATCH', { sha: commit.sha });
  return commit.sha;
}
