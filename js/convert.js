// 변환기 — 인라인화, 압축, 플랫폼 포맷 변환, 미리보기 렌더

// ---------- HTML 압축 (리스 out 용) ----------
// 줄바꿈이 포함된 공백만 한 칸으로 접음. 같은 줄 공백(의도된 띄어쓰기)은 보존.
export function minify(html) {
  return String(html)
    .replace(/<!--(?!\s*<)[\s\S]*?-->/g, '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---------- <style> → 인라인 style ----------
const DYNAMIC_PSEUDO = /:(hover|active|focus|focus-within|focus-visible|visited|target|checked|placeholder-shown)\b|::?(before|after|placeholder|selection|marker|first-line|first-letter)\b/i;

function splitTopLevel(str, sep) {
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of str) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parseDecls(cssText) {
  const map = new Map();
  for (const d of splitTopLevel(cssText, ';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const prop = d.slice(0, i).trim().toLowerCase();
    let val = d.slice(i + 1).trim();
    const imp = /!important\s*$/i.test(val);
    if (imp) val = val.replace(/\s*!important\s*$/i, '');
    if (prop) map.set(prop, { val, imp });
  }
  return map;
}
export function specificity(sel) {
  const s = sel.replace(/:(not|is|where)\(([^)]*)\)/g, ' $2 ');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const rest = s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?/g, ' ');
  const c = (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return a * 10000 + b * 100 + c;
}

export function inlineCss(html, { dropClass = true } = {}) {
  const warnings = [];
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
  const styles = [...doc.querySelectorAll('style')];
  if (!styles.length) return { html, warnings, changed: false };
  const hits = new Map(); // el -> [{spec, order, decls}]
  let order = 0;
  for (const st of styles) {
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(st.textContent); }
    catch (e) { warnings.push('CSS 파싱 실패: ' + e.message); st.remove(); continue; }
    for (const r of sheet.cssRules) {
      const t = r.constructor.name;
      if (t === 'CSSStyleRule') {
        for (const sel of splitTopLevel(r.selectorText, ',').map(s => s.trim())) {
          if (DYNAMIC_PSEUDO.test(sel)) { warnings.push(`'${sel}' — 호버·의사요소는 인라인 불가라 제외했어요 (::before/::after는 span으로 바꿔야 함)`); continue; }
          let els;
          try { els = doc.body.querySelectorAll(sel.replace(/^(:root|html|body)\b\s*/, '') || '*'); } catch { warnings.push(`'${sel}' 선택자를 해석하지 못했어요`); continue; }
          const decls = parseDecls(r.style.cssText);
          const spec = specificity(sel);
          const o = order++;
          els.forEach(el => { if (!hits.has(el)) hits.set(el, []); hits.get(el).push({ spec, order: o, decls }); });
        }
      } else if (t === 'CSSKeyframesRule') warnings.push(`@keyframes ${r.name} — 리스는 CSS 애니메이션이 안 돼요. SVG SMIL(<animate>)로 바꿔야 해요`);
      else if (t === 'CSSMediaRule') warnings.push('@media 규칙은 인라인화할 수 없어 제외했어요');
      else if (t === 'CSSFontFaceRule' || t === 'CSSImportRule') warnings.push('@font-face/@import 는 제외했어요 — 폰트는 플랫폼에서 따로 불러와야 해요');
      else warnings.push(`${t} 규칙은 제외했어요`);
    }
    st.remove();
  }
  for (const [el, list] of hits) {
    list.sort((x, y) => x.spec - y.spec || x.order - y.order);
    const merged = new Map();
    for (const h of list) for (const [p, d] of h.decls) {
      const prev = merged.get(p);
      if (prev && prev.imp && !d.imp) continue;
      merged.set(p, d);
    }
    const own = parseDecls(el.getAttribute('style') || '');
    for (const [p, d] of own) { const prev = merged.get(p); if (prev && prev.imp && !d.imp) continue; merged.set(p, d); }
    el.setAttribute('style', [...merged].map(([p, d]) => `${p}:${d.val}${d.imp ? ' !important' : ''}`).join('; '));
  }
  if (dropClass) doc.body.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
  if (/animation\s*:/i.test(doc.body.innerHTML)) warnings.push('animation 속성이 남아 있어요 — 리스에서는 동작하지 않아요');
  return { html: doc.body.innerHTML, warnings, changed: true };
}

export function toRisuOut(html) {
  const r = inlineCss(html);
  return { out: minify(r.html), warnings: r.warnings };
}

// ---------- 정규식 포맷 ----------
const RISU_TYPE = { display: 'editdisplay', input: 'editinput', output: 'editoutput', request: 'editprocess' };
export function risuRegexFile(rules) {
  return {
    type: 'regex',
    data: rules.map(r => ({
      comment: r.comment || '',
      in: r.in,
      out: r.out,
      type: RISU_TYPE[r.kind] || r.type || 'editdisplay',
      ableFlag: true,
      flag: normalizeRisuFlag(r.flag, r.out)
    }))
  };
}
export function normalizeRisuFlag(flag, out = '') {
  let f = String(flag || 'g');
  const cbs = /<cbs>/.test(f) || /\{\{(getvar|calc|#if|button|setvar|random)/.test(out);
  const letters = [...new Set(f.replace(/<[^>]*>/g, '').replace(/[^gimsuy]/g, '').split(''))];
  if (!letters.includes('g')) letters.unshift('g');
  if (cbs && !letters.includes('u')) letters.push('u');
  return letters.join('') + (cbs ? '<cbs>' : '');
}
export function jsFlags(flag) {
  return [...new Set(String(flag || 'g').replace(/<[^>]*>/g, '').replace(/[^gimsuy]/g, '').split(''))].join('') || 'g';
}

const ST_PLACEMENT = { display: [2], output: [2], input: [1], request: [2] };
export function stRegexList(rules) {
  return rules.map(r => ({
    id: uuid(),
    scriptName: r.comment || 'regex',
    findRegex: `/${r.in.replace(/(?<!\\)\//g, '\\/')}/${jsFlags(r.flag)}`,
    replaceString: r.kind === 'display' || !r.kind ? minify(r.out) : r.out,
    trimStrings: [],
    placement: ST_PLACEMENT[r.kind] || [2],
    disabled: false,
    markdownOnly: !r.kind || r.kind === 'display',
    promptOnly: r.kind === 'request',
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null
  }));
}
export function parseStFind(find) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(find || '');
  return m ? { src: m[1], flags: m[2] || 'g' } : { src: find || '', flags: 'g' };
}
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }

// 임의의 정규식 JSON → 공통 규칙 배열 [{comment,in,out,flag,platform}]
export function normalizeRegexJson(j) {
  if (j && j.type === 'regex' && Array.isArray(j.data)) j = j.data;
  if (!Array.isArray(j)) j = [j];
  return j.filter(Boolean).map(r => {
    if ('findRegex' in r) { const f = parseStFind(r.findRegex); return { comment: r.scriptName, in: f.src, out: (r.replaceString || '').replace(/\{\{match\}\}/g, '$&'), flag: f.flags, platform: 'st' }; }
    return { comment: r.comment, in: r.in, out: r.out, flag: r.flag, platform: 'risu' };
  });
}

// ---------- 로어북 포맷 ----------
export function toStWorldInfo(entries) {
  const out = { entries: {} };
  entries.forEach((e, i) => {
    out.entries[i] = {
      uid: i, key: e.keys || [], keysecondary: e.secondaryKeys || [], comment: e.comment || '', content: e.content || '',
      constant: !!e.constant, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
      order: e.order ?? 100, position: e.position ?? 0, disable: false, ignoreBudget: false,
      excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false,
      probability: 100, useProbability: true, depth: 4, outletName: '', group: '', groupOverride: false, groupWeight: 100,
      scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: null,
      sticky: 0, cooldown: 0, delay: 0, triggers: [], displayIndex: i,
      characterFilter: { isExclude: false, names: [], tags: [] }
    };
  });
  return out;
}
export function toRisuLorebook(entries) {
  return {
    type: 'risu', ver: 1,
    data: entries.map(e => ({
      key: (e.keys || []).join(', '), secondkey: (e.secondaryKeys || []).join(', '),
      insertorder: e.order ?? 100, comment: e.comment || '', content: e.content || '',
      mode: 'normal', alwaysActive: !!e.constant, selective: !!(e.secondaryKeys && e.secondaryKeys.length), useRegex: false
    }))
  };
}
export function loreEntries(j) {
  if (j?.entries && typeof j.entries === 'object') {
    return Object.values(j.entries).map(e => ({ comment: e.comment, keys: e.key || [], secondaryKeys: e.keysecondary || [], content: e.content, constant: !!e.constant, order: e.order, disabled: !!e.disable }));
  }
  const arr = j?.type === 'risu' ? j.data : Array.isArray(j) ? j : [];
  return arr.map(e => ({ comment: e.comment, keys: String(e.key || '').split(',').map(s => s.trim()).filter(Boolean), secondaryKeys: String(e.secondkey || '').split(',').map(s => s.trim()).filter(Boolean), content: e.content, constant: !!e.alwaysActive, order: e.insertorder }));
}

// ---------- 미리보기 렌더 ----------
function cbsPreview(out, vars = {}) {
  return String(out)
    .replace(/\{\{button::\s*([^:}]*?)\s*::\s*([^}]*?)\s*\}\}/g, (_, label) => `<span style="display:inline-block;padding:3px 10px;margin:2px;border:1px dashed currentColor;border-radius:6px;opacity:.85;font-size:.9em;">${label}</span>`)
    .replace(/\{\{getvar::\s*([^}]+?)\s*\}\}/g, (_, n) => vars[n] ?? '50')
    .replace(/\{\{calc::\s*([^}]+?)\s*\}\}/g, (_, e) => /^[\d\s+\-*/().%]+$/.test(e) ? String(safeCalc(e)) : '50')
    .replace(/\{\{#if[^}]*\}\}|\{\{\/if\}\}|\{\{:else\}\}/g, '');
}
function safeCalc(e) { try { const v = Function(`"use strict";return (${e})`)(); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 50; } catch { return 50; } }

// 플랫폼 렌더 흉내: 정규식을 순서대로 적용 → 리스는 남은 \n을 전부 <br>로 (실제 깨짐까지 재현)
export function renderSample(sample, rules, platform = 'risu', vars = {}) {
  let text = String(sample || '');
  const errors = [];
  for (const r of rules) {
    let re;
    try { re = new RegExp(r.in, jsFlags(r.flag)); } catch (e) { errors.push(`${r.comment || '정규식'}: ${e.message}`); continue; }
    text = text.replace(re, cbsPreview(r.out, vars));
  }
  if (platform === 'risu') {
    text = text.replace(/\r?\n/g, '<br>');
  } else {
    text = text.split(/(<style[\s\S]*?<\/style>)/i).map((seg, i) => i % 2 ? seg : seg.replace(/>\s*\n\s*</g, '><').replace(/\r?\n/g, '<br>')).join('');
  }
  return { html: text, errors };
}

const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', '-apple-system', 'blinkmacsystemfont', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'pretendard', 'apple sd gothic neo', 'malgun gothic', 'arial', 'helvetica', 'times new roman', 'georgia', 'courier new', 'segoe ui']);
export function detectFonts(html) {
  const set = new Set();
  for (const m of String(html).matchAll(/font-family\s*:\s*([^;"]+(?:"[^"]*"[^;"]*)*)/gi)) {
    for (let f of m[1].split(',')) {
      f = f.replace(/&quot;|['"]/g, '').trim();
      if (f && !GENERIC_FONTS.has(f.toLowerCase()) && /^[A-Za-z0-9 ]+$/.test(f)) set.add(f);
    }
  }
  return [...set].slice(0, 12);
}
export function previewDoc(bodyHtml, { bg = 'dark' } = {}) {
  const links = detectFonts(bodyHtml).map(f => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}&display=swap">`).join('');
  const dark = bg === 'dark';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${links}<style>html,body{margin:0}body{padding:16px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;font-size:15px;line-height:1.75;color:${dark ? '#e6e0d6' : '#2a2622'};background:${dark ? '#1a181d' : '#f5f2ec'};word-break:keep-all;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${bodyHtml}</body></html>`;
}
