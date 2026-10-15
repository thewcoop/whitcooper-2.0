// Converts a post file <-> editor blocks. Pure functions: runs in the browser and in Node tests.
// The HTML written here matches what the site already styles (cms-photo, cms-photo-row).

const MANAGED = ['title', 'date', 'summary', 'coverImage', 'draft'];

export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s = '') =>
  String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------- frontmatter ----------
function parseScalar(v) {
  v = v.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { /* fall through */ } }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

export function splitFile(raw) {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: '', body: raw };
}

export function parseFrontmatter(fm) {
  const entries = [];
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (m && !/^\s/.test(line)) entries.push({ key: m[1], lines: [m[2]], raw: [line] });
    else if (entries.length) { entries.at(-1).lines.push(line.trim()); entries.at(-1).raw.push(line); }
  }
  const data = {};
  const extra = [];
  for (const e of entries) {
    if (MANAGED.includes(e.key)) data[e.key] = parseScalar(e.lines.filter(Boolean).join(' '));
    else extra.push(e.raw.join('\n'));
  }
  return { data, extra };
}

// ---------- blocks ----------
export function parseBody(body) {
  const chunks = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).filter((c) => c.trim());
  return chunks.map(parseChunk);
}

const attr = (html, name) => {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  return m ? unesc(m[1]) : '';
};

function parseChunk(c) {
  const t = c.trim();
  if (/^<div class="cms-photo-row"/.test(t)) {
    const figs = [...t.matchAll(/<figure>([\s\S]*?)<\/figure>/g)].map((f) => ({
      src: attr(f[1], 'src'),
      alt: attr(f[1], 'alt'),
      caption: unesc((f[1].match(/<figcaption>([\s\S]*?)<\/figcaption>/) || [, ''])[1]),
    }));
    return { type: 'row', cols: Number(attr(t, 'data-cols')) || 2, aspect: attr(t, 'data-aspect') || 'natural', photos: figs };
  }
  if (/^<figure class="cms-photo"/.test(t)) {
    return {
      type: 'photo',
      src: attr(t, 'src'), alt: attr(t, 'alt'),
      caption: unesc((t.match(/<figcaption>([\s\S]*?)<\/figcaption>/) || [, ''])[1]),
      size: attr(t, 'data-size') || 'full', align: attr(t, 'data-align') || 'center', aspect: attr(t, 'data-aspect') || 'natural',
    };
  }
  if (/^<div class="cms-video"/.test(t)) return { type: 'video', url: attr(t, 'data-url') };
  if (/^## [^\n]+$/.test(t)) return { type: 'heading', text: t.slice(3) };
  if (/^> /.test(t)) return { type: 'quote', text: t.split('\n').map((l) => l.replace(/^> ?/, '')).join('\n') };
  return { type: 'text', text: t };
}

export function videoEmbed(url) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}${vm[2] ? `?h=${vm[2]}` : ''}`;
  return null;
}

const figure = (p, indent) =>
  `${indent}<figure>\n${indent}  <img src="${esc(p.src)}" alt="${esc(p.alt || p.caption)}" loading="lazy" />\n` +
  (p.caption ? `${indent}  <figcaption>${esc(p.caption)}</figcaption>\n` : '') + `${indent}</figure>`;

export function serializeBlock(b) {
  switch (b.type) {
    case 'text': return b.text.trim();
    case 'heading': return `## ${b.text.replace(/\n/g, ' ').trim()}`;
    case 'quote': return b.text.trim().split('\n').map((l) => `> ${l}`).join('\n');
    case 'photo':
      return `<figure class="cms-photo" data-align="${b.align}" data-size="${b.size}" data-aspect="${b.aspect}">\n` +
        `  <img src="${esc(b.src)}" alt="${esc(b.alt || b.caption)}" loading="lazy" />\n` +
        (b.caption ? `  <figcaption>${esc(b.caption)}</figcaption>\n` : '') + `</figure>`;
    case 'row':
      return `<div class="cms-photo-row" data-cols="${b.cols}" data-aspect="${b.aspect}">\n` +
        b.photos.map((p) => figure(p, '  ')).join('\n') + `\n</div>`;
    case 'video': {
      if (!(b.url || '').trim()) return '';
      const embed = videoEmbed(b.url || '');
      return `<div class="cms-video" data-url="${esc(b.url)}">\n  ` +
        (embed
          ? `<iframe src="${embed}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`
          : `<a href="${esc(b.url)}">${esc(b.url)}</a>`) + `\n</div>`;
    }
    default: return '';
  }
}

export const serializeBody = (blocks) => blocks.map(serializeBlock).filter(Boolean).join('\n\n') + '\n';

// ---------- whole file ----------
export function parsePost(raw) {
  const { fm, body } = splitFile(raw);
  const { data, extra } = parseFrontmatter(fm);
  return {
    meta: {
      title: data.title || '', date: data.date || '', summary: data.summary || '',
      coverImage: data.coverImage || '', draft: data.draft === 'true',
    },
    extra,
    blocks: parseBody(body),
  };
}

export function serializePost({ meta, extra = [], blocks }) {
  const q = (v) => JSON.stringify(v);
  const lines = [`title: ${q(meta.title)}`, `date: ${q(meta.date)}`];
  if (meta.summary) lines.push(`summary: ${q(meta.summary)}`);
  if (meta.coverImage) lines.push(`coverImage: ${q(meta.coverImage)}`);
  if (meta.draft) lines.push('draft: true');
  lines.push(...extra);
  return `---\n${lines.join('\n')}\n---\n${serializeBody(blocks)}`;
}

export const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'post';
