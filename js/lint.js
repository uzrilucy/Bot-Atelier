// 규칙 위반 검사기 — 룽님 지식 팩 기반
import { minify, normalizeRisuFlag, jsFlags, parseStFind, loreEntries } from './convert.js';

export const KINDS = {
  auto: '자동 감지', risuRegex: '리스 정규식', stRegex: '실리 정규식', risuTrigger: '리스 트리거',
  stLore: '실리 월드인포', risuLore: '리스 로어북', card: '캐릭터 카드', html: 'HTML·상태창', prompt: '프롬프트 텍스트', board: '배포 게시판 글꾸'
};

const I = (level, code, msg, where = '', fixable = false) => ({ level, code, msg, where, fixable });

// ---------- 감지 ----------
export function detect(text) {
  const t = String(text || '').trim();
  if (!t) return { kind: 'empty' };
  if (t[0] === '{' || t[0] === '[') {
    try { const j = JSON.parse(t); return { kind: detectJson(j), json: j }; }
    catch (e) { return { kind: 'badjson', error: e.message }; }
  }
  if (/<(div|span|svg|table|section|p|img)\b/i.test(t)) return { kind: 'html' };
  return { kind: 'prompt' };
}
function detectJson(j) {
  if (Array.isArray(j)) {
    const f = j.find(x => x && typeof x === 'object') || {};
    if ('in' in f && 'out' in f) return 'risuRegex';
    if ('conditions' in f && 'effect' in f) return 'risuTrigger';
    if ('findRegex' in f) return 'stRegex';
    if ('key' in f && 'content' in f) return 'risuLore';
    return 'unknownJson';
  }
  if (j?.type === 'regex' && Array.isArray(j.data)) return 'risuRegex';
  if (j?.type === 'risu' && Array.isArray(j.data)) return 'risuLore';
  if (j?.entries && typeof j.entries === 'object') return 'stLore';
  if (j && 'findRegex' in j) return 'stRegex';
  if (j?.spec && /chara_card/.test(j.spec)) return 'card';
  if (j?.data && (j.data.description !== undefined || j.data.first_mes !== undefined)) return 'card';
  if (j && (j.description !== undefined && j.first_mes !== undefined)) return 'card';
  return 'unknownJson';
}

// ---------- 프롬프트 텍스트 규칙 ----------
const RX = {
  lang: [
    /\b(respond|reply|write|answer|output|speak|narrate)\b[^.\n]{0,40}\b(only\s+)?in\s+(korean|english|japanese|chinese)\b/i,
    /\b(always|must)\s+use\s+(korean|english|japanese)\b/i,
    /(한국어|영어|일본어)로(만)?\s*(작성|출력|응답|대답|서술|답변)/,
    /\boutput\s+language\b/i
  ],
  imperson: [
    /\b(never|do\s+not|don'?t|must\s+not|avoid|refrain\s+from)\b[^.\n]{0,60}\b(speak|act|talk|write|decide|describe|narrate|control|impersonate)\w*\b[^.\n]{0,30}\b(for|as|on\s+behalf\s+of)\s+\{\{user\}\}/i,
    /\{\{user\}\}\s*'?s?\s*(actions?|dialogues?|thoughts?|lines?|reactions?)[^.\n]{0,40}\b(never|do\s+not|don'?t|must\s+not|forbidden)/i,
    /\{\{user\}\}의\s*(대사|행동|말|생각|반응)[^.\n]{0,30}(쓰지|작성하지|묘사하지|대신하지|금지|말\s*것|않)/,
    /\b(no|avoid)\s+(user\s+)?impersonation\b/i
  ],
  pov: [
    /\b(first|second|third)[-\s]person\b/i, /\b(present|past)\s+tense\b/i, /\bPOV\b/,
    /[123]인칭/, /(현재|과거)\s*시제/, /시점으로\s*(서술|작성)/
  ],
  notForced: [/\bnot\s+(forced|enforced|mandatory)\b/i, /강제하지\s*않/, /자유롭게\s*(설정|선택)/],
  examples: /(sample\s+quotes?|example\s+dialogues?|example\s+messages?|<START>|mes_example|예시\s*대사|샘플\s*대사|대사\s*예시)/i,
  examplesGuard: /(reference\s+only|for\s+(tone|style)\s+reference|do\s+not\s+(copy|parrot|reuse|repeat)|don'?t\s+(copy|parrot|reuse|repeat)|not\s+to\s+be\s+(copied|reused)|참고용|그대로\s*(쓰|사용|복사|반복)하지|복사\s*금지)/i,
  badVar: /\{\{\s*(user|char)\s*\}(?!\})|\{\{\s*(user|char)\s*\]|\{\s*(user|char)\s*\}\}|\{\{\s*(User|Char|USER|CHAR)\s*\}\}|\{\{\s+(user|char)|(user|char)\s+\}\}/
};

export function lintText(text, where = '본문') {
  const out = [];
  if (!text || typeof text !== 'string') return out;
  const hit = (arr) => arr.map(r => text.match(r)).find(Boolean);
  let m;
  if ((m = hit(RX.lang))) out.push(I('warn', 'P-LANG', `출력 언어를 강제하는 문구가 있어요: “${snip(m[0])}” — 언어는 플레이어가 정하도록 빼는 걸 권장해요.`, where));
  if ((m = hit(RX.imperson))) out.push(I('warn', 'P-IMP', `{{user}} 사칭 금지 규칙이 들어 있어요: “${snip(m[0])}” — 플레이어 프롬프트와 충돌하므로 빼는 걸 권장해요.`, where));
  if ((m = hit(RX.pov))) out.push(I('warn', 'P-POV', `시점·시제를 언급하고 있어요: “${snip(m[0])}” — 아예 언급하지 않는 게 원칙이에요.`, where));
  if ((m = hit(RX.notForced))) out.push(I('info', 'P-NOTE', `“${snip(m[0])}” — 강제하지 않는다는 안내 문구도 충돌 원인이 돼요. 언어·시점·사칭 관련이면 삭제하세요.`, where));
  if (RX.examples.test(text) && !RX.examplesGuard.test(text)) out.push(I('warn', 'P-EX', '예시 대사가 있는데 “참고용, 그대로 복사 금지” 안내가 없어요 — AI가 예시를 그대로 반복할 위험이 커요.', where));
  if ((m = text.match(RX.badVar))) out.push(I('error', 'P-VAR', `변수 표기 오타: “${m[0]}” — {{user}} / {{char}} 형태로 고쳐야 해요.`, where));
  return out;
}
const snip = (s) => s.length > 60 ? s.slice(0, 57) + '…' : s;

// ---------- HTML 규칙 ----------
export function lintHtml(html, platform = 'risu', where = 'HTML', { asRegexOut = false } = {}) {
  const out = [];
  const h = String(html || '');
  if (/<script\b/i.test(h)) out.push(I('error', 'H-JS', '<script> 는 두 플랫폼 모두 표시용 정규식에서 쓰지 않아요.', where));
  if (platform === 'risu') {
    if (/<style\b/i.test(h)) out.push(I('error', 'R-STYLE', '<style> 태그는 리스에서 동작하지 않아요 — 인라인 style로 바꿔야 해요.', where, true));
    if (/@keyframes|animation\s*:/i.test(h)) out.push(I('error', 'R-ANIM', 'CSS 애니메이션(@keyframes/animation)은 리스에서 안 돼요 — SVG SMIL(<animate>)을 쓰세요.', where));
    if (/\sclass\s*=/i.test(h)) out.push(I('warn', 'R-CLASS', 'class 속성은 리스에서 의미가 없어요 (스타일시트 미지원).', where, true));
    if (/\r?\n/.test(h)) out.push(I(asRegexOut ? 'error' : 'info', 'R-NL', asRegexOut ? 'out 안에 줄바꿈이 있어요 — 리스가 \\n 을 <br> 로 바꿔 레이아웃·SVG가 깨져요. 한 줄로 압축해야 해요.' : '정규식 out에 넣을 때는 한 줄 압축이 필요해요.', where, true));
    if (/\{\{calc::[^}]*\{\{getvar/i.test(h)) out.push(I('error', 'R-NEST', '{{calc}} 안에 {{getvar}} 를 중첩하면 평가가 실패해요.', where));
    if (/calc\(/i.test(h) && /\{\{getvar/i.test(h)) out.push(I('info', 'R-CSSCALC', 'CSS calc() 대신 CBS {{calc::}} 로 계산하는 편이 안정적이에요.', where));
    if (/stroke-dasharray/i.test(h) && /circle/i.test(h) && !/pathLength\s*=\s*["']?100/i.test(h)) out.push(I('info', 'R-RING', '원형 게이지는 pathLength="100" 을 주면 0–100 값을 둘레 계산 없이 바로 쓸 수 있어요.', where));
  } else {
    const classes = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].flatMap(m => [...m[1].matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(x => x[1]));
    if (classes.length) {
      const prefixes = new Set(classes.map(c => (c.match(/^([a-zA-Z0-9]+)[-_]/) || [])[1] || '∅'));
      if (prefixes.has('∅') || prefixes.size > 1) out.push(I('warn', 'S-NS', `클래스 네임스페이스가 통일돼 있지 않아요 (${[...prefixes].filter(p => p !== '∅').join(', ') || '접두사 없음'}) — 테마 충돌 방지를 위해 고유 접두사를 붙이세요.`, where));
    }
  }
  return out;
}

// ---------- 게시판 글꾸 ----------
export function lintBoard(html, where = '게시글') {
  const out = [];
  const h = String(html || '');
  if (/ㅠ|ㅜ_?ㅜ|ㅜㅜ|T_T|ㅠ_ㅠ/.test(h)) out.push(I('error', 'B-CRY', '우는 이모티콘(ㅠㅠ/ㅜㅜ 등)이 있어요 — 배포 사이트 금지·경고 사항이에요.', where));
  if (/<style\b|\sclass\s*=/i.test(h)) out.push(I('error', 'B-INLINE', '게시판 글꾸는 전부 인라인 스타일이어야 해요 (<style>·class 불가).', where));
  for (const m of h.matchAll(/background(?:-color)?\s*:\s*rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*(0?\.\d+|0)\s*\)/gi)) {
    if (parseFloat(m[1]) < 0.85) { out.push(I('warn', 'B-RGBA', `반투명 배경(${snip(m[0])}) — 게시판 글자색 자동 보정 때문에 그 위 글자가 흐려져요. 불투명 hex를 쓰세요.`, where)); break; }
  }
  const imgs = (h.match(/<img\b/gi) || []).length;
  if (imgs) {
    const wrapped = (h.match(/<div[^>]*width\s*:\s*\d+px[^>]*>\s*<img\b/gi) || []).length;
    if (wrapped < imgs) out.push(I('warn', 'B-IMG', `이미지 ${imgs - wrapped}개가 고정폭 div로 감싸져 있지 않아요 — 전체 폭으로 늘어나요.`, where));
    out.push(I('info', 'B-IMGMARK', '게시판은 이미지 옆에 숫자 마크가 붙어요. 구분선 같은 장식 이미지라면 CSS로 대체하세요.', where));
  }
  return out.concat(lintText(h.replace(/<[^>]+>/g, ' '), where).filter(x => x.code === 'P-VAR'));
}

// ---------- 정규식 ----------
function regexValid(src, flags) { try { new RegExp(src, flags); return null; } catch (e) { return e.message; } }

export function lintRisuRegex(j) {
  const list = Array.isArray(j) ? j : j.data;
  const out = [];
  list.forEach((r, i) => {
    const w = `#${i + 1} ${r.comment || '(이름 없음)'}`;
    const err = regexValid(r.in || '', jsFlags(r.flag));
    if (!r.in) out.push(I('error', 'R-IN', 'in 패턴이 비어 있어요.', w));
    else if (err) out.push(I('error', 'R-IN', `in 정규식 오류: ${err}`, w));
    const outStr = String(r.out ?? '');
    const isHtml = /<[a-z][\s\S]*>/i.test(outStr);
    if (isHtml && r.type !== 'editdisplay') out.push(I('warn', 'R-TYPE', `HTML 출력인데 type이 "${r.type}" 이에요 — 표시용은 "editdisplay".`, w, true));
    if (r.ableFlag !== true) out.push(I('warn', 'R-ABLE', 'ableFlag 가 true 가 아니에요.', w, true));
    if (!/g/.test(String(r.flag || '').replace(/<[^>]*>/g, ''))) out.push(I('warn', 'R-FLAG', 'flag 에 g 가 없어요.', w, true));
    if (/\{\{(getvar|calc|#if|setvar)/.test(outStr) && !/<cbs>/.test(r.flag || '')) out.push(I('warn', 'R-CBS', 'out 에서 CBS를 쓰는데 flag 에 <cbs> 가 없어요 ("gu<cbs>" 권장).', w, true));
    out.push(...lintHtml(outStr, 'risu', w, { asRegexOut: true }));
  });
  // 순서 의존성: 칩 분리(||) 정규식이 메인보다 앞에 있으면 경고
  const chipIdx = list.findIndex(r => /^\\s\*\\\|\\\|\\s\*$|^\\\|\\\|$/.test(r.in || ''));
  if (chipIdx >= 0) {
    const mainIdx = list.findIndex((r, k) => k !== chipIdx && /\\\|\\\|/.test(r.in || ''));
    if (mainIdx > chipIdx) out.push(I('error', 'R-ORDER', `칩 분리 정규식(#${chipIdx + 1})이 메인 블록(#${mainIdx + 1})보다 앞에 있어요 — 메인 → 칩 순서여야 해요.`, '순서'));
  }
  const names = list.map(r => r.comment).filter(Boolean);
  const dup = names.filter((n, k) => names.indexOf(n) !== k);
  if (dup.length) out.push(I('info', 'R-DUP', `comment 이름 중복: ${[...new Set(dup)].join(', ')}`, '전체'));
  return out;
}

export function lintStRegex(j) {
  const list = Array.isArray(j) ? j : [j];
  const out = [];
  list.forEach((r, i) => {
    const w = `#${i + 1} ${r.scriptName || '(이름 없음)'}`;
    const f = parseStFind(r.findRegex);
    const err = regexValid(f.src, f.flags.replace(/[^gimsuy]/g, ''));
    if (!r.findRegex) out.push(I('error', 'S-FIND', 'findRegex 가 비어 있어요.', w));
    else if (!/^\/[\s\S]*\/[a-z]*$/.test(r.findRegex)) out.push(I('warn', 'S-FIND', 'findRegex 는 /패턴/플래그 형태를 권장해요.', w));
    else if (err) out.push(I('error', 'S-FIND', `정규식 오류: ${err}`, w));
    const rep = String(r.replaceString || '');
    const isHtml = /<[a-z][\s\S]*>/i.test(rep);
    if (isHtml && r.markdownOnly !== true) out.push(I('warn', 'S-MD', '표시용 HTML인데 markdownOnly 가 true 가 아니에요.', w, true));
    if (isHtml && !(r.placement || []).includes(2)) out.push(I('warn', 'S-PLACE', 'placement 에 2(AI 출력)가 없어요.', w, true));
    if (isHtml && /\r?\n/.test(rep)) out.push(I('warn', 'S-NL', 'replaceString 이 압축돼 있지 않아요 — 마크다운 처리로 깨질 수 있어요.', w, true));
    if (r.disabled) out.push(I('info', 'S-OFF', '비활성화(disabled) 상태예요.', w));
    if (isHtml) out.push(...lintHtml(rep, 'st', w));
  });
  return out;
}

// ---------- 트리거 ----------
const TRIGGER_TYPES = ['start', 'manual', 'output', 'input', 'display', 'request'];
export function lintTrigger(list) {
  const out = [];
  list.forEach((t, i) => {
    const w = `#${i + 1} ${t.comment || '(이름 없음)'}`;
    if (!TRIGGER_TYPES.includes(t.type)) out.push(I('warn', 'T-TYPE', `알 수 없는 type "${t.type}"`, w));
    if (t.type === 'manual' && !t.comment) out.push(I('error', 'T-NAME', '버튼용(manual) 트리거는 comment 가 있어야 {{button::라벨::comment}} 로 호출할 수 있어요.', w));
    if (!Array.isArray(t.effect) || !t.effect.length) out.push(I('warn', 'T-EFF', 'effect 가 비어 있어요.', w));
    (t.effect || []).forEach((e, k) => {
      if (!e.type) out.push(I('error', 'T-EFF', `effect ${k + 1}: type 누락`, w));
      if (e.type === 'v2SetVar' && !e.var) out.push(I('error', 'T-VAR', `effect ${k + 1}: v2SetVar 에 var 가 없어요.`, w));
      if (e.type === 'v2Impersonate' && !e.value) out.push(I('warn', 'T-IMP', `effect ${k + 1}: v2Impersonate 값이 비어 있어요.`, w));
    });
  });
  const manual = list.filter(t => t.type === 'manual').map(t => t.comment).filter(Boolean);
  if (manual.length) out.push(I('info', 'T-BTN', `버튼 호출명: ${manual.map(n => `{{button::라벨::${n}}}`).join('  ')}`, '참고'));
  return out;
}

// ---------- 로어북 ----------
export function lintLore(j, kind) {
  const entries = loreEntries(j);
  const out = [];
  if (!entries.length) out.push(I('error', 'L-EMPTY', '엔트리가 없어요.', '전체'));
  entries.forEach((e, i) => {
    const w = `#${i + 1} ${e.comment || '(이름 없음)'}`;
    if (!e.constant && !e.keys.filter(k => k.trim()).length) out.push(I('warn', 'L-KEY', '키워드가 없는 비상시 엔트리 — 발동되지 않아요.', w));
    if (!String(e.content || '').trim()) out.push(I('warn', 'L-BODY', '본문이 비어 있어요.', w));
    const c = String(e.content || '');
    const hangul = (c.match(/[가-힣]/g) || []).length;
    if (c.length > 80 && hangul / c.length > 0.3) out.push(I('info', 'L-LANG', '본문 대부분이 한국어예요 — 영어로 쓰면 토큰을 크게 아낄 수 있어요.', w));
    if (e.keys.length && !e.keys.some(k => /[가-힣]/.test(k))) out.push(I('info', 'L-KO', '한국어 키워드가 없어요 — 한국어로 플레이하면 발동이 안 될 수 있어요.', w));
    out.push(...lintText(c, w));
  });
  if (entries.length >= 4 && !entries.some(e => e.constant)) out.push(I('info', 'L-INDEX', '항시활성 요약(인덱스) 엔트리가 없어요 — 키워드 엔트리를 색인하는 constant 엔트리를 두는 구성을 권장해요.', '구성'));
  const allKeys = entries.flatMap(e => e.keys.map(k => k.trim().toLowerCase())).filter(Boolean);
  const dup = [...new Set(allKeys.filter((k, i) => allKeys.indexOf(k) !== i))];
  if (dup.length) out.push(I('info', 'L-DUPKEY', `여러 엔트리에 겹치는 키워드: ${dup.slice(0, 12).join(', ')}${dup.length > 12 ? ' …' : ''}`, '구성'));
  return out;
}

// ---------- 캐릭터 카드 ----------
export function lintCard(j) {
  const d = j.data || j;
  const out = [];
  for (const f of ['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'first_mes', 'mes_example', 'creator_notes']) {
    if (d[f]) out.push(...lintText(String(d[f]), f));
  }
  if (d.character_book?.entries) out.push(...lintLore({ type: 'risu', data: d.character_book.entries.map(e => ({ key: (e.keys || []).join(','), content: e.content, comment: e.comment || e.name, alwaysActive: e.constant })) }, 'risuLore'));
  return out;
}

// ---------- 진입점 ----------
export function lint(text, forced = 'auto', platform = 'risu') {
  const det = detect(text);
  let kind = forced === 'auto' ? det.kind : forced;
  if (det.kind === 'badjson' && (forced === 'auto' || /Regex|Lore|Trigger|card/.test(forced))) {
    return { kind: 'badjson', issues: [I('error', 'J-PARSE', `JSON 구문 오류: ${det.error}`, '전체')] };
  }
  const j = det.json;
  let issues = [];
  try {
    switch (kind) {
      case 'risuRegex': issues = lintRisuRegex(j); break;
      case 'stRegex': issues = lintStRegex(j); break;
      case 'risuTrigger': issues = lintTrigger(Array.isArray(j) ? j : [j]); break;
      case 'stLore': case 'risuLore': issues = lintLore(j, kind); break;
      case 'card': issues = lintCard(j); break;
      case 'html': issues = lintHtml(text, platform).concat(lintText(text.replace(/<[^>]+>/g, ' '))); break;
      case 'board': issues = lintBoard(text); break;
      case 'prompt': issues = lintText(text); break;
      case 'unknownJson': issues = [I('info', 'J-UNK', '형식을 알 수 없는 JSON이에요. 종류를 직접 골라 주세요.', '전체')]; break;
      case 'empty': issues = []; break;
      default: issues = lintText(text);
    }
  } catch (e) {
    issues = [I('error', 'X', `선택한 종류로 해석할 수 없어요: ${e.message}`, '전체')];
  }
  return { kind, issues };
}

// ---------- 자동 수정 ----------
export function autoFix(text, kind) {
  if (kind === 'html') return { text: minify(text), notes: ['한 줄 압축'] };
  const j = JSON.parse(text);
  const notes = [];
  if (kind === 'risuRegex') {
    const list = Array.isArray(j) ? j : j.data;
    list.forEach(r => {
      const o = String(r.out ?? '');
      if (/<[a-z][\s\S]*>/i.test(o)) {
        if (/\r?\n/.test(o)) { r.out = minify(o); notes.push(`${r.comment}: out 압축`); }
        if (r.type !== 'editdisplay') { r.type = 'editdisplay'; notes.push(`${r.comment}: type → editdisplay`); }
      }
      if (r.ableFlag !== true) { r.ableFlag = true; notes.push(`${r.comment}: ableFlag → true`); }
      const nf = normalizeRisuFlag(r.flag, r.out);
      if (nf !== r.flag) { notes.push(`${r.comment}: flag ${r.flag || '(없음)'} → ${nf}`); r.flag = nf; }
    });
    const wrapped = Array.isArray(j) ? { type: 'regex', data: list } : j;
    if (Array.isArray(j)) notes.push('리스 정규식 파일 형식({"type":"regex","data":[...]})으로 감쌈');
    return { text: JSON.stringify(wrapped, null, 2), notes, json: wrapped };
  }
  if (kind === 'stRegex') {
    const list = Array.isArray(j) ? j : [j];
    list.forEach(r => {
      const rep = String(r.replaceString || '');
      if (/<[a-z][\s\S]*>/i.test(rep)) {
        if (r.markdownOnly !== true) { r.markdownOnly = true; notes.push(`${r.scriptName}: markdownOnly → true`); }
        if (!(r.placement || []).includes(2)) { r.placement = [...(r.placement || []), 2]; notes.push(`${r.scriptName}: placement 에 2 추가`); }
        if (/\r?\n/.test(rep)) { r.replaceString = minify(rep); notes.push(`${r.scriptName}: replaceString 압축`); }
      }
    });
    return { text: JSON.stringify(Array.isArray(j) ? list : list[0], null, 2), notes };
  }
  return { text, notes: ['이 종류는 자동 수정 항목이 없어요'] };
}
