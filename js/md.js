// 가벼운 마크다운 렌더러 — 코드 블록은 액션 툴바를 붙일 수 있도록 따로 수집
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMd(src, { streaming = false } = {}) {
  const codes = [];
  const text = String(src ?? '');
  const out = [];
  const lines = text.split('\n');
  let i = 0, list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(t => `<li>${inline(t)}</li>`).join('')}</${list.tag}>`); list = null; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      const closed = i < lines.length;
      i++;
      const idx = codes.length;
      const code = buf.join('\n');
      codes.push({ lang: lang.toLowerCase(), code, closed });
      out.push(`<figure class="code" data-ci="${idx}"><figcaption><span class="lang">${esc(lang || 'text')}</span><span class="code-meta">${code.split('\n').length}줄${!closed && streaming ? ' · 작성 중…' : ''}</span><span class="code-acts" data-ci="${idx}"></span></figcaption><pre><code>${esc(code)}</code></pre></figure>`);
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(4, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*(---|───+|___)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); i++; continue; }
    if ((m = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[2]); i++; continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); i++; continue; }
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }
    flushList(); para.push(line); i++;
  }
  flushPara(); flushList();
  return { html: out.join(''), codes };
}
