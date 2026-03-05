/**
 * upload-media.js — Netlify Function
 *
 * Accepts a POST from the CMS editor with a base64-encoded image, commits it
 * to the GitHub repo using a GitHub token stored in the GITHUB_TOKEN env var.
 *
 * Authentication: Caller must include a valid Netlify Identity JWT in the
 * Authorization header. Netlify validates it and populates context.clientContext.user.
 *
 * Setup (one-time):
 *   1. Create a GitHub fine-grained PAT for this repo with Contents: Read+Write
 *      OR a classic PAT with 'repo' (or 'public_repo') scope.
 *   2. In Netlify → Site settings → Environment variables, add:
 *         GITHUB_TOKEN  =  <your token>
 */

const REPO         = 'thewcoop/whitcooper-2.0';
const BRANCH       = 'main';
const UPLOADS_PATH = 'public/uploads';

exports.handler = async function (event, context) {
  // ── Method guard ──
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Auth guard: requires a valid Netlify Identity session ──
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return json(401, { error: 'Not authenticated. Please log in to the CMS.' });
  }

  // ── GitHub token check ──
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return json(500, {
      error:
        'GITHUB_TOKEN environment variable is not set. ' +
        'Add it in Netlify → Site settings → Environment variables.',
    });
  }

  // ── Parse body ──
  let content, filename;
  try {
    ({ content, filename } = JSON.parse(event.body || '{}'));
  } catch (_) {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!content || !filename) {
    return json(400, { error: 'Missing required fields: content, filename' });
  }

  const filePath = `${UPLOADS_PATH}/${filename}`;
  const apiBase  = `https://api.github.com/repos/${REPO}`;

  const headers = {
    Authorization:        `Bearer ${GITHUB_TOKEN}`,
    'Content-Type':       'application/json',
    Accept:               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':         'whitcooper-cms-upload/1.0',
  };

  async function gh(path, method = 'GET', body = null) {
    const resp = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data.message || JSON.stringify(data)).slice(0, 200);
      throw new Error(`GitHub ${resp.status}: ${msg}`);
    }
    return data;
  }

  try {
    // 1. Create blob
    const blob = await gh('/git/blobs', 'POST', { content, encoding: 'base64' });

    // 2. Get current branch tip
    const ref       = await gh(`/git/refs/heads/${BRANCH}`);
    const commitSha = ref.object.sha;

    // 3. Get tree SHA from the tip commit
    const commit    = await gh(`/git/commits/${commitSha}`);

    // 4. Create new tree with the uploaded file added
    const newTree   = await gh('/git/trees', 'POST', {
      base_tree: commit.tree.sha,
      tree: [{ path: filePath, mode: '100644', type: 'blob', sha: blob.sha }],
    });

    // 5. Create a new commit
    const newCommit = await gh('/git/commits', 'POST', {
      message: `Upload ${filename} via CMS`,
      parents: [commitSha],
      tree: newTree.sha,
    });

    // 6. Advance the branch ref
    await gh(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: newCommit.sha });

    return json(200, { path: `/uploads/${filename}` });

  } catch (err) {
    console.error('[upload-media] error:', err.message);
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
