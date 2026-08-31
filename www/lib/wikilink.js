function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    img.src = `/api/image?campaign=${encodeURIComponent(campaign)}&name=${encodeURIComponent(name)}`;
  });
}
