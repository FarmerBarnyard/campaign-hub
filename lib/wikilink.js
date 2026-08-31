// 2026-08-23 security review (found while reviewing the Worker routes this
// consumes): this was missing quote-escaping while its own output gets
// interpolated straight into HTML attribute values below (data-embed="...",
// data-link="..."), e.g. ![[x" onerror="alert(1)]] in a note body -- which
// can come from a generated note (raw model output) or a forged-Origin
// direct POST to /campaign/note -- broke out of the attribute and executed.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineFormat(text) {
  let out = escapeHtml(text);
  out = out.replace(/!\[\[([^\]]+)\]\]/g, (m, name) => `<img data-embed="${escapeHtml(name)}" alt="${escapeHtml(name)}" class="note-embed">`);
  out = out.replace(/\[\[([^\]]+)\]\]/g, (m, name) => `<span class="wikilink" data-link="${escapeHtml(name)}">${escapeHtml(name)}</span>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  return out;
}

// Small markdown-ish renderer covering exactly what this app's generated notes
// use: #/##/### headers, "- " bullet lists, bold/italic, wikilinks, embeds.
// Not a general markdown parser.
function renderNoteBody(container, campaign, body) {
  const lines = (body || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineFormat(line.replace(/^\s*-\s+/, ''))}</li>`;
      continue;
    } else if (inList) { html += '</ul>'; inList = false; }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^(#{1,3})/)[1].length;
      const tag = `h${level + 2}`;
      html += `<${tag}>${inlineFormat(line.replace(/^#{1,3}\s+/, ''))}</${tag}>`;
    } else if (line.trim() === '') {
      // blank line -- paragraph break, no output needed
    } else {
      html += `<p>${inlineFormat(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  container.innerHTML = html;

  container.querySelectorAll('img[data-embed]').forEach((img) => {
    const name = img.getAttribute('data-embed');
    img.src = `${API_BASE}/image?campaign=${encodeURIComponent(campaign)}&name=${encodeURIComponent(name)}`;
  });
}

// Serializes frontmatter + body into the same "---\nkey: val\n---\nbody" shape
// the Worker writes to R2, and triggers a browser download -- this is the
// bridge for pulling a generated note into the real local Obsidian vault,
// since a public site can't write to it directly.
function serializeNoteMarkdown(frontmatter, body) {
  let out = '---\n';
  for (const key of Object.keys(frontmatter)) {
    const val = frontmatter[key];
    if (Array.isArray(val)) {
      out += `${key}:\n`;
      for (const item of val) out += `  - ${item}\n`;
    } else if (val === null || val === undefined || val === '') {
      out += `${key}:\n`;
    } else {
      out += `${key}: ${val}\n`;
    }
  }
  out += '---\n' + (body || '');
  return out;
}

function downloadNoteAsMarkdown(title, frontmatter, body) {
  const content = serializeNoteMarkdown(frontmatter, body);
  const filename = title.replace(/[\\/:*?"<>|]/g, '').trim() + '.md';
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
