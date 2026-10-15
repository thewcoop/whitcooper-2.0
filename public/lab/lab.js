// Shared prototype chrome: switcher + feedback panel (copies a note you can paste back to Claude).
(() => {
  const page = document.body.dataset.proto || '';
  const names = { a: 'A · The Lens', b: 'B · The Workshop', c: 'C · Prism Stage' };
  const bar = document.createElement('nav');
  bar.className = 'lab-bar';
  bar.innerHTML = ['a', 'b', 'c'].map((k) => `<a href="/lab/${k}.html" class="${k === page ? 'cur' : ''}">${k.toUpperCase()}</a>`).join('') + '<a href="/lab/">All</a>';
  document.body.append(bar);

  const tags = ['Love the cursor light', 'More RGB split', 'Less RGB split', 'More playful', 'More sleek', 'Too much motion', 'Want more motion', 'Text too small', 'Love the layout', 'Layout feels off', 'Feels like me', 'Feels generic'];
  const picked = new Set();
  const fab = document.createElement('button');
  fab.className = 'lab-fab';
  fab.textContent = 'Feedback';
  const panel = document.createElement('div');
  panel.className = 'lab-panel';
  panel.innerHTML = `<h4>What do you think of ${names[page] || 'this'}?</h4><p>Tap what fits, add a note, then copy it and paste it to Claude.</p><div class="lab-tags"></div><textarea placeholder="Anything else: what to keep, cut, or push further"></textarea><button class="copy">Copy my feedback</button>`;
  const box = panel.querySelector('.lab-tags');
  tags.forEach((t) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => { picked.has(t) ? picked.delete(t) : picked.add(t); b.setAttribute('aria-pressed', picked.has(t)); };
    box.append(b);
  });
  panel.querySelector('.copy').onclick = async (e) => {
    const text = `Feedback on ${names[page] || 'prototype'}: ${[...picked].join('; ') || 'no tags'}${panel.querySelector('textarea').value ? ` | Notes: ${panel.querySelector('textarea').value}` : ''}`;
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    e.target.textContent = 'Copied. Paste it to Claude';
    setTimeout(() => (e.target.textContent = 'Copy my feedback'), 2500);
  };
  fab.onclick = () => panel.classList.toggle('open');
  document.body.append(panel, fab);
})();
