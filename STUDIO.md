# Studio — your own admin

Live at `/studio`. Sign in with Face ID / Touch ID (a passkey). Write posts from your phone or Mac,
preview them as they will look, save drafts, and publish. Saving commits to GitHub, which rebuilds
the site on Netlify (about a minute).

## One-time setup (Netlify → Site configuration → Environment variables)

| Name | What it is |
| --- | --- |
| `GITHUB_TOKEN` | A GitHub token that can write to this repo (Contents: read and write). Already used by the old uploader. |
| `SESSION_SECRET` | A long random string that signs login cookies. Never share it. |
| `SETUP_CODE` | A code you choose. Needed to add a passkey the first time, or on a new device if you lose your passkey. |

Optional: `GITHUB_BRANCH` (defaults to `main`), `GITHUB_REPO` (defaults to `thewcoop/whitcooper-2.0`).

After adding them, trigger a redeploy. Then open `/studio`, enter the setup code, and create your passkey.
Use **Add this device** inside Studio to add your other devices.

## How it works

- `public/studio/` — the app (plain HTML/JS, installable on a phone's home screen).
- `public/studio/post-format.js` — turns the editor's blocks into the post HTML the site already styles.
- `netlify/functions/auth.mjs` — passkey sign-in. Passkeys are stored in Netlify Blobs.
- `netlify/functions/posts.mjs` — reads, saves and deletes posts and photos through the GitHub API (one commit per save).
- Drafts have `draft: true` in the post and are hidden from the site.
