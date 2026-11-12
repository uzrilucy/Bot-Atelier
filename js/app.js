import { db, uid } from './db.js';
import * as P from './providers.js';
import { DEFAULT_MODULES, DEFAULT_PERSONA, KB_VERSION, KB_MIGRATE, buildSystem, platformLabel } from './knowledge.js';
import * as L from './lint.js';
import * as C from './convert.js';
import * as G from './gen.js';
import { renderMd, esc } from './md.js';
import { ICON, BRAND } from './icons.js';

export const VERSION = '0.2.0';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const V = () => $('#view');

const S = {
  settings: null, kb: null, projects: [], pid: null, threads: [], tid: null, tab: 'chat',
  abort: null, busy: false, codes: {},
  forge: { kind: 'lore', inputs: {}, result: null, busy: false },
  studio: { inputs: {}, spec: null, width: 412, bg: 'dark', pane: 'rules', busy: false, warnings: [] },
  lint: { text: '', mode: 'auto', platform: 'risu', result: null, fixed: null },
  board: { inputs: { kind: '홍보', width: 700 }, spec: null, bg: 'light', busy: false },
  vaultAll: false
};

const TABS = [
  { id: 'chat', label: '작업실', en: 'DESK', icon: 'chat' },
  { id: 'forge', label: '생성기', en: 'FORGE', icon: 'forge' },
  { id: 'studio', label: '상태창', en: 'STUDIO', icon: 'studio' },
  { id: 'board', label: '글꾸', en: 'BOARD', icon: 'board' },
  { id: 'lint', label: '검사기', en: 'INSPECT', icon: 'lint' },
  { id: 'vault', label: '보관함', en: 'VAULT', icon: 'vault' }
];

// ───────────────────────── 공통 유틸 ─────────────────────────
const curProject = () => S.projects.find(p => p.id === S.pid);
const curThread = () => S.threads.find(t => t.id === S.tid);
const defaultPlatform = () => curProject()?.platform && curProject().platform !== 'both' ? curProject().platform : 'risu';
const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const safeName = (s) => String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${esc(msg)}</span>`;
  $('#toast').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, kind === 'err' ? 4200 : 2200);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('복사했어요');
}
function download(name, text, type = 'application/json') {
  // JSON 임포트 호환을 위해 BOM 없이 UTF-8 로 저장
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast(`${name} 저장`);
}
function readFile(accept = '.json,.txt,.html,.md') {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return res(null); res({ name: f.name, text: await f.text() }); };
    inp.click();
  });
}

function openSheet({ title, body, wide = false, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div><section class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="닫기">${ICON.x}</button></header><div class="sheet-body">${body}</div></section>`;
  $('#sheet-root').appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => { if (closed) return; closed = true; wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 240); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  onMount && onMount($('.sheet-body', wrap), close);
  return close;
}
function confirmSheet(msg, okLabel = '확인', danger = true) {
  return new Promise(res => {
    let done = false;
    const close = openSheet({
      title: '확인', body: `<p class="confirm-msg">${esc(msg)}</p><div class="row end"><button class="btn ghost" data-no>취소</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`,
      onMount: (b, cl) => {
        $('[data-yes]', b).onclick = () => { done = true; res(true); cl(); };
        $('[data-no]', b).onclick = () => { done = true; res(false); cl(); };
      },
      onClose: () => { if (!done) res(false); }
    });
  });
}

const saveSettings = debounce(() => db.put('kv', S.settings), 300);
const saveKb = () => db.put('kv', S.kb);
const saveUi = () => db.put('kv', { id: 'ui', pid: S.pid, tab: S.tab, tid: S.tid });

// ───────────────────────── 부트 ─────────────────────────
async function boot() {
  const def = P.defaultProviderConfig();
  S.settings = (await db.get('kv', 'settings')) || { id: 'settings', ...def, persona: '' };
  for (const k of Object.keys(def)) {
    if (S.settings[k] === undefined) S.settings[k] = def[k];
    else if (def[k] && typeof def[k] === 'object') S.settings[k] = { ...def[k], ...S.settings[k] };
  }
  if (!Array.isArray(S.settings.customs)) S.settings.customs = [];
  if (!S.settings.applied) S.settings.applied = {};
  S.kb = (await db.get('kv', 'knowledge')) || { id: 'knowledge', version: KB_VERSION, modules: structuredClone(DEFAULT_MODULES) };
  for (let v = (S.kb.version || 1) + 1; v <= KB_VERSION; v++) {
    for (const id of KB_MIGRATE[v] || []) {
      const def = DEFAULT_MODULES.find(m => m.id === id), cur = S.kb.modules.find(m => m.id === id);
      if (def && cur) { cur.content = def.content; cur.scope = def.scope; cur.title = def.title; }
    }
    S.kb.version = v; await db.put('kv', S.kb);
  }
  for (const m of DEFAULT_MODULES) if (!S.kb.modules.some(x => x.id === m.id) && !(S.kb.removed || []).includes(m.id)) S.kb.modules.push(structuredClone(m));
  S.projects = (await db.all('projects')).sort((a, b) => a.createdAt - b.createdAt);
  if (!S.projects.length) {
    const p = { id: uid(), name: '첫 번째 봇', platform: '', memo: '', createdAt: Date.now() };
    await db.put('projects', p); S.projects = [p];
  }
  const ui = (await db.get('kv', 'ui')) || {};
  S.pid = S.projects.some(p => p.id === ui.pid) ? ui.pid : S.projects[0].id;
  await loadThreads(ui.tid);
  renderChrome();
  setTab(ui.tab && (TABS.some(t => t.id === ui.tab) || ui.tab === 'settings') ? ui.tab : 'chat');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function loadThreads(preferId) {
  S.threads = (await db.all('threads')).filter(t => t.projectId === S.pid).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!S.threads.length) {
    const t = { id: uid(), projectId: S.pid, title: '새 대화', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    await db.put('threads', t); S.threads = [t];
  }
  S.tid = S.threads.some(t => t.id === preferId) ? preferId : S.threads[0].id;
}

// ───────────────────────── 크롬 (헤더·탭) ─────────────────────────
function renderChrome() {
  const p = curProject();
  $('#top').innerHTML = `
    <div class="brand">${BRAND}<div class="brand-text"><b>봇 아틀리에</b><small>BOT ATELIER</small></div></div>
    <button class="project-btn" data-act="projects" aria-label="프로젝트 바꾸기">
      <span class="project-name">${esc(p?.name || '')}</span>
      <span class="plat plat-${p?.platform || 'none'}">${esc(p?.platform === 'risu' ? '리스' : p?.platform === 'st' ? '실리' : p?.platform === 'both' ? '리스+실리' : '플랫폼 미정')}</span>
      ${ICON.chevron}
    </button>
    <button class="icon-btn ${S.tab === 'settings' ? 'on' : ''}" data-act="tab" data-tab="settings" aria-label="설정">${ICON.gear}</button>`;
  $('#tabs').innerHTML = TABS.map(t => `<button class="tab ${S.tab === t.id ? 'on' : ''}" data-act="tab" data-tab="${t.id}" aria-label="${t.label}">${ICON[t.icon]}<span>${t.label}</span><i>${t.en}</i></button>`).join('');
}

function setTab(tab) {
  S.tab = tab; saveUi(); renderChrome();
  ({ chat: viewChat, forge: viewForge, studio: viewStudio, board: viewBoard, lint: viewLint, vault: viewVault, settings: viewSettings })[tab]();
  V().scrollTop = 0;
}

function secHead(no, en, ko, sub = '') {
  return `<div class="sec-head"><div class="sec-label"><span class="no">${no}</span><span class="en">${en}</span></div><h1>${ko}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
}
function platformSelect(name, val, withBoth = false) {
  const opts = [['risu', '리스AI'], ['st', '실리태번']].concat(withBoth ? [['both', '둘 다']] : []);
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" class="${val === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, name, cb) {
  const seg = $(`[data-seg="${name}"]`, root);
  if (!seg) return;
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset.v);
  });
}
function issuesHtml(issues, { compact = false } = {}) {
  if (!issues) return '';
  const cnt = { error: 0, warn: 0, info: 0 };
  issues.forEach(i => cnt[i.level]++);
  const head = `<div class="lint-sum"><span class="lv error">오류 ${cnt.error}</span><span class="lv warn">경고 ${cnt.warn}</span><span class="lv info">참고 ${cnt.info}</span>${!cnt.error && !cnt.warn ? '<span class="lint-ok">' + ICON.check + ' 규칙 위반 없음</span>' : ''}</div>`;
  if (!issues.length) return head;
  const order = { error: 0, warn: 1, info: 2 };
  return head + `<ul class="issues ${compact ? 'compact' : ''}">${[...issues].sort((a, b) => order[a.level] - order[b.level]).map(i => `<li class="issue ${i.level}"><div class="issue-top"><span class="lv ${i.level}">${{ error: '오류', warn: '경고', info: '참고' }[i.level]}</span><code>${esc(i.code)}</code>${i.where ? `<span class="where">${esc(i.where)}</span>` : ''}${i.fixable ? '<span class="fixable">자동수정</span>' : ''}</div><p>${esc(i.msg)}</p></li>`).join('')}</ul>`;
}
function issuesText(issues) {
  return issues.filter(i => i.level !== 'info').map(i => `- [${i.code}] ${i.where ? i.where + ': ' : ''}${i.msg}`).join('\n');
}

// ───────────────────────── 보관함 저장 ─────────────────────────
const KIND_LABEL = { lorebook: '로어북', regex: '정규식', trigger: '트리거', ui: '상태창', board: '글꾸', prompt: '프롬프트', html: 'HTML', other: '기타' };
function kindFromLint(k) {
  return { risuRegex: 'regex', stRegex: 'regex', risuTrigger: 'trigger', stLore: 'lorebook', risuLore: 'lorebook', html: 'html', prompt: 'prompt', board: 'board', card: 'other' }[k] || 'other';
}
async function saveArtifact({ kind, platform, title, content, meta = {} }) {
  const all = await db.all('artifacts');
  const same = all.find(a => a.projectId === S.pid && a.kind === kind && a.title === title);
  const now = Date.now();
  if (same) {
    if (same.content === content) { toast('이미 같은 내용이 보관돼 있어요'); return same; }
    same.history = [...(same.history || []), { content: same.content, meta: same.meta, at: same.updatedAt }].slice(-30);
    Object.assign(same, { content, meta, platform, updatedAt: now });
    await db.put('artifacts', same);
    toast(`보관함: “${title}” v${same.history.length + 1} 저장`);
    return same;
  }
  const a = { id: uid(), projectId: S.pid, kind, platform, title, content, meta, history: [], createdAt: now, updatedAt: now };
  await db.put('artifacts', a);
  toast(`보관함에 “${title}” 저장`);
  return a;
}
function askTitle(def) {
  return new Promise(res => {
    openSheet({
      title: '보관함에 저장', body: `<label class="field"><span>이름 (같은 이름이면 새 버전으로 쌓여요)</span><input id="art-title" value="${esc(def)}"></label><div class="row end"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="art-ok">저장</button></div>`,
      onMount: (b, close) => { const i = $('#art-title', b); i.select(); $('#art-ok', b).onclick = () => { res(i.value.trim() || def); close(); }; i.onkeydown = e => { if (e.key === 'Enter') $('#art-ok', b).click(); }; }
    });
  });
}

// ───────────────────────── 1. 작업실 (채팅) ─────────────────────────
const SUGGEST = [
  { t: '캐릭터 설계', d: '숨겨진 동기·말투·관계성까지', p: '새 캐릭터를 같이 설계하고 싶어요. 먼저 컨셉을 말씀드릴게요: ' },
  { t: '로어북 구조 짜기', d: '키워드 엔트리 + 인덱스 구성', p: '이 세계관의 로어북 구조를 같이 짜 주세요. 세계관 요약: ' },
  { t: '상태창 컨셉 회의', d: '정보 위계부터 디자인 언어까지', p: '상태창 디자인 컨셉을 같이 잡고 싶어요. 봇 분위기: ' },
  { t: '프롬프트 검토', d: 'OOC·설정 충돌·규칙 위반 점검', p: '아래 시스템 프롬프트를 검토해 주세요. OOC 위험, 설정 충돌, 토큰 낭비를 짚어 주세요.\n\n' }
];

function viewChat() {
  const th = curThread();
  V().innerHTML = `<section class="chat">
    <div class="subbar">
      <button class="chip-btn" data-act="threads">${ICON.list}<span class="ellipsis">${esc(th.title === '새 대화' ? '대화 목록' : th.title)}</span></button>
      <span class="grow"></span>
      <button class="chip-btn" data-act="new-thread">${ICON.plus}<span>새 대화</span></button>
    </div>
    <div class="msgs" id="msgs"></div>
    <form class="composer" id="composer">
      <div class="composer-box">
        <textarea id="prompt" rows="1" placeholder="설정·캐릭터·정규식… 무엇이든 같이 만들어요"></textarea>
        <button type="submit" class="send ${S.busy ? 'busy' : ''}" id="send" aria-label="${S.busy ? '중지' : '보내기'}">${S.busy ? ICON.stop : ICON.send}</button>
      </div>
      <div class="composer-foot">
        <button type="button" class="pill" data-act="tab" data-tab="settings">${ICON.book}<span>지식 ${S.kb.modules.filter(m => m.enabled).length}</span></button>
        <button type="button" class="pill ${customsFor('chat').length ? 'lit' : ''}" data-act="chat-prompts">${ICON.scroll}<span>프롬프트 ${customsFor('chat').length}</span></button>
        <button type="button" class="pill" data-act="tab" data-tab="settings">${ICON.link}<span>${esc(P.activeModelLabel(S.settings))}</span></button>
        <span class="grow"></span><span class="hint-key">Ctrl+Enter 전송</span>
      </div>
    </form>
  </section>`;
  const ta = $('#prompt');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    if (S.busy) { S.abort?.abort(); return; }
    const t = ta.value.trim(); if (!t) return;
    ta.value = ''; fit(); sendChat(t);
  });
  if (S.pendingPrompt) { ta.value = S.pendingPrompt; S.pendingPrompt = null; fit(); ta.focus(); }
  renderMsgs(true);
}

function renderMsgs(scroll = false) {
  const box = $('#msgs'); if (!box) return;
  const th = curThread();
  if (!th.messages.length) {
    const p = curProject();
    box.innerHTML = `<div class="empty-desk">
      <div class="desk-mark">${BRAND}</div>
      <h2>${esc(p.name)}</h2>
      <p>${p.platform ? esc(platformLabel(p.platform)) : '플랫폼 미정'} · 지식 ${S.kb.modules.filter(m => m.enabled).length}개가 탑재된 제작 파트너와 대화해요.</p>
      <div class="suggest">${SUGGEST.map((s, i) => `<button class="suggest-card" data-act="suggest" data-i="${i}"><b>${s.t}</b><span>${s.d}</span></button>`).join('')}</div>
      ${!p.platform ? `<button class="btn small ghost" data-act="projects">${ICON.edit} 프로젝트 플랫폼 지정하기</button>` : ''}
    </div>`;
    return;
  }
  box.innerHTML = th.messages.map((m, i) => msgHtml(m, i)).join('');
  th.messages.forEach((m, i) => { if (m.role === 'assistant' && !m.error) decorateCodes(i); });
  if (scroll) box.scrollTop = box.scrollHeight;
}
function msgHtml(m, i) {
  if (m.role === 'user') return `<article class="msg user" data-mi="${i}"><div class="msg-body">${esc(m.content).replace(/\n/g, '<br>')}</div><div class="msg-acts"><button class="mini" data-act="msg-copy" data-mi="${i}" aria-label="복사">${ICON.copy}</button><button class="mini" data-act="msg-edit" data-mi="${i}" aria-label="수정해서 다시 보내기">${ICON.edit}</button><button class="mini" data-act="msg-del" data-mi="${i}" aria-label="삭제">${ICON.trash}</button></div></article>`;
  const r = m.error ? { html: `<p>${esc(m.content)}</p>` } : renderMd(m.content, { streaming: m.streaming });
  if (!m.error) S.codes[i] = r.codes;
  const last = i === curThread().messages.length - 1;
  return `<article class="msg assistant ${m.error ? 'error' : ''} ${m.streaming ? 'streaming' : ''}" data-mi="${i}">
    <div class="msg-seal">${m.error ? '!' : '아'}</div>
    <div class="msg-main"><div class="msg-body">${r.html || '<p class="typing"><i></i><i></i><i></i></p>'}</div>
    ${m.streaming ? '' : `<div class="msg-acts">${m.error ? '' : `<button class="mini" data-act="msg-copy" data-mi="${i}" aria-label="복사">${ICON.copy}</button><button class="mini" data-act="msg-save" data-mi="${i}" aria-label="보관함 저장">${ICON.vault}</button>`}${last ? `<button class="mini" data-act="msg-regen" data-mi="${i}" aria-label="다시 생성">${ICON.refresh}</button>` : ''}<button class="mini" data-act="msg-del" data-mi="${i}" aria-label="삭제">${ICON.trash}</button>${m.model ? `<span class="msg-model">${esc(m.model)}</span>` : ''}</div>`}</div>
  </article>`;
}
function decorateCodes(mi) {
  const art = $(`.msg[data-mi="${mi}"]`); if (!art) return;
  const codes = S.codes[mi] || [];
  $$('.code-acts', art).forEach(el => {
    const ci = +el.dataset.ci; const c = codes[ci]; if (!c) return;
    const isJson = c.lang === 'json' || /^\s*[\[{]/.test(c.code);
    const isHtml = c.lang === 'html' || /^\s*<(div|span|svg|section|table|style)/i.test(c.code);
    const b = (op, icon, label) => `<button class="code-btn" data-act="code" data-op="${op}" data-mi="${mi}" data-ci="${ci}" title="${label}">${ICON[icon]}<span>${label}</span></button>`;
    el.innerHTML = b('copy', 'copy', '복사') + (isJson || isHtml ? b('lint', 'lint', '검사') : '') + (isHtml ? b('preview', 'eye', '미리보기') : '') + (isJson && /"(in|findRegex)"\s*:/.test(c.code) ? b('preview-regex', 'eye', '렌더') : '') + b('save', 'vault', '보관') + b('dl', 'download', '받기');
  });
}

async function sendChat(text, { replaceLast = false } = {}) {
  const th = curThread();
  if (!replaceLast) th.messages.push({ role: 'user', content: text, ts: Date.now() });
  if (th.title === '새 대화') th.title = text.replace(/\s+/g, ' ').slice(0, 28);
  const hist = th.messages.filter(m => !m.error).slice(-(Number(S.settings.history) || 30)).map(({ role, content }) => ({ role, content }));
  const asst = { role: 'assistant', content: '', ts: Date.now(), streaming: true };
  th.messages.push(asst);
  S.busy = true; S.abort = new AbortController();
  if (S.tab === 'chat') { viewChat(); }
  const mi = th.messages.length - 1;
  let raf = 0;
  const paint = () => {
    raf = 0;
    if (!asst.streaming) return;
    const body = $(`.msg[data-mi="${mi}"] .msg-body`); if (!body) return;
    const box = $('#msgs');
    const atBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    body.innerHTML = renderMd(asst.content, { streaming: true }).html;
    if (atBottom) box.scrollTop = box.scrollHeight;
  };
  try {
    const system = buildSystem({ kb: S.kb, persona: S.settings.persona, project: curProject(), scope: 'chat',
      extra: '# 응답 방식\n요청을 분석해 캐릭터·봇 기획 / UI·상태창 디자인 / 코딩·시스템 / 스토리 창작 / 게시판 글꾸 중 맞는 관점으로 답하고, 복합 요청이면 관점을 연결하세요. 결론부터.', customs: customsFor('chat') });
    await P.chat({ system, messages: hist, cfg: S.settings, signal: S.abort.signal, onDelta: (_, full) => { asst.content = full; if (!raf) raf = requestAnimationFrame(paint); } });
    asst.model = S.settings[S.settings.active]?.model;
  } catch (e) {
    if (e.name === 'AbortError') { if (!asst.content) { asst.content = '(중지됨)'; asst.error = true; } }
    else { asst.error = true; asst.content = e.message; }
  } finally {
    if (raf) cancelAnimationFrame(raf);
    delete asst.streaming;
    S.busy = false; S.abort = null;
    th.updatedAt = Date.now();
    await db.put('threads', th);
    if (S.tab === 'chat') { viewChat(); }
  }
}

function threadSheet() {
  const body = `<div class="list">${S.threads.map(t => `<div class="list-row ${t.id === S.tid ? 'on' : ''}"><button class="list-main" data-tid="${t.id}"><b>${esc(t.title)}</b><small>${t.messages.length}개 메시지 · ${fmtDate(t.updatedAt)}</small></button><button class="icon-btn" data-rename="${t.id}" aria-label="이름 바꾸기">${ICON.edit}</button><button class="icon-btn" data-del="${t.id}" aria-label="삭제">${ICON.trash}</button></div>`).join('')}</div>`;
  openSheet({
    title: '대화 목록', body, onMount: (b, close) => {
      b.addEventListener('click', async e => {
        const sel = e.target.closest('[data-tid]'); const ren = e.target.closest('[data-rename]'); const del = e.target.closest('[data-del]');
        if (sel) { S.tid = sel.dataset.tid; saveUi(); close(); viewChat(); }
        if (ren) { const t = S.threads.find(x => x.id === ren.dataset.rename); const n = prompt('대화 이름', t.title); if (n) { t.title = n; await db.put('threads', t); close(); threadSheet(); viewChat(); } }
        if (del) { if (!(await confirmSheet('이 대화를 삭제할까요?', '삭제'))) return; await db.del('threads', del.dataset.del); await loadThreads(S.tid === del.dataset.del ? null : S.tid); close(); viewChat(); }
      });
    }
  });
}

// ───────────────────────── 프로젝트 ─────────────────────────
function projectSheet() {
  const p = curProject();
  const body = `
    <div class="list">${S.projects.map(x => `<button class="list-row list-main ${x.id === S.pid ? 'on' : ''}" data-pid="${x.id}"><b>${esc(x.name)}</b><small>${esc(platformLabel(x.platform))}</small></button>`).join('')}</div>
    <button class="btn ghost full" id="pj-new">${ICON.plus} 새 프로젝트</button>
    <div class="divider"><span>현재 프로젝트 설정</span></div>
    <label class="field"><span>이름</span><input id="pj-name" value="${esc(p.name)}"></label>
    <div class="field"><span>대상 플랫폼</span><div class="seg" data-seg="pj-plat">${[['', '미정'], ['risu', '리스AI'], ['st', '실리태번'], ['both', '둘 다']].map(([v, l]) => `<button type="button" class="${(p.platform || '') === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    <label class="field"><span>프로젝트 메모 — 세계관 요약·결정사항 (모든 대화와 생성에 함께 전달돼요)</span><textarea id="pj-memo" rows="7" placeholder="예) 여성향 무협, 15세가. 주인공은 몰락한 세가의 막내…">${esc(p.memo || '')}</textarea></label>
    <div class="row between"><button class="btn danger ghost" id="pj-del">${ICON.trash} 프로젝트 삭제</button><button class="btn primary" id="pj-save">${ICON.check} 저장</button></div>`;
  openSheet({
    title: '프로젝트', body, onMount: (b, close) => {
      let plat = p.platform || '';
      bindSeg(b, 'pj-plat', v => plat = v);
      b.addEventListener('click', async e => {
        const sel = e.target.closest('[data-pid]');
        if (sel && sel.dataset.pid !== S.pid) { S.pid = sel.dataset.pid; await loadThreads(); saveUi(); close(); renderChrome(); setTab(S.tab); }
      });
      $('#pj-save', b).onclick = async () => { p.name = $('#pj-name', b).value.trim() || p.name; p.platform = plat; p.memo = $('#pj-memo', b).value; await db.put('projects', p); close(); renderChrome(); setTab(S.tab); toast('프로젝트를 저장했어요'); };
      $('#pj-new', b).onclick = async () => {
        const np = { id: uid(), name: '새 봇 프로젝트', platform: '', memo: '', createdAt: Date.now() };
        await db.put('projects', np); S.projects.push(np); S.pid = np.id; await loadThreads(); saveUi(); close(); renderChrome(); setTab(S.tab); projectSheet();
      };
      $('#pj-del', b).onclick = async () => {
        if (S.projects.length < 2) return toast('마지막 프로젝트는 지울 수 없어요', 'err');
        if (!(await confirmSheet(`“${p.name}” 과 그 대화·보관함을 모두 삭제할까요?`, '삭제'))) return;
        for (const t of await db.all('threads')) if (t.projectId === p.id) await db.del('threads', t.id);
        for (const a of await db.all('artifacts')) if (a.projectId === p.id) await db.del('artifacts', a.id);
        await db.del('projects', p.id);
        S.projects = S.projects.filter(x => x.id !== p.id); S.pid = S.projects[0].id; await loadThreads(); saveUi(); close(); renderChrome(); setTab(S.tab);
      };
    }
  });
}

// ───────────────────────── AI 공통 호출 (생성기·스튜디오) ─────────────────────────
async function runTask(task, scope, onDelta, target) {
  const system = buildSystem({ kb: S.kb, persona: S.settings.persona, project: curProject(), scope, extra: task.extra, customs: target ? customsFor(target) : [] });
  return P.chat({ system, messages: [{ role: 'user', content: task.user }], cfg: { ...S.settings, temperature: Math.min(Number(S.settings.temperature), 1) }, onDelta });
}
function progressHtml(label) {
  return `<div class="progress"><div class="loom"><i></i><i></i><i></i><i></i><i></i></div><div><b>${esc(label)}</b><small id="prog-count">응답 대기 중…</small></div></div>`;
}
const progDelta = (_, full) => { const el = $('#prog-count'); if (el) el.textContent = `${full.length.toLocaleString()}자 수신`; };

// ───────────────────────── 2. 생성기 ─────────────────────────
const FORGE_KINDS = { lore: '로어북', regex: '정규식', trigger: '트리거' };
const FORGE_TARGET = { lore: 'lore', regex: 'regex', trigger: 'trigger' };
function viewForge() {
  const F = S.forge;
  F.platform = F.platform || defaultPlatform();
  if (F.kind === 'trigger') F.platform = 'risu';
  const inp = F.inputs[F.kind] || (F.inputs[F.kind] = {});
  const form = {
    lore: `<label class="field"><span>무엇에 대한 로어북인가요?</span><textarea id="f-brief" rows="6" placeholder="세계관·장소·세력·인물·용어 등을 자유롭게. 길어도 괜찮아요.">${esc(inp.brief || '')}</textarea></label>
      <div class="row wrap"><label class="field inline"><span>엔트리 수</span><input id="f-count" type="number" min="1" max="60" placeholder="자동" value="${esc(inp.count || '')}"></label>
      <label class="check"><input type="checkbox" id="f-index" ${inp.index !== false ? 'checked' : ''}><span>항시활성 인덱스 엔트리 추가</span></label></div>`,
    regex: `<label class="field"><span>어떤 정규식이 필요한가요?</span><textarea id="f-brief" rows="6" placeholder="예) <!--숨김--> 주석 태그를 화면에서 지우기 / [시스템] 줄을 작은 회색 글씨로 / 사용자 입력의 ((OOC)) 를 요청에서만 제거">${esc(inp.brief || '')}</textarea></label>
      <p class="note">상태창 같은 디자인 UI는 <button class="link" data-act="tab" data-tab="studio">상태창 스튜디오</button>에서 미리보기와 함께 만드는 걸 추천해요.</p>`,
    trigger: `<label class="field"><span>어떤 트리거·버튼 동작이 필요한가요?</span><textarea id="f-brief" rows="6" placeholder="예) 패널에 '상점', '인벤토리', '지도' 버튼. 누르면 각각 phone_action 변수를 바꾸고 [상점 열기] 같은 행동을 유저 입력으로 보냄. 출력이 끝나면 action 변수 초기화.">${esc(inp.brief || '')}</textarea></label>
      <p class="note">트리거는 리스AI 전용이에요.</p>`
  }[F.kind];
  V().innerHTML = `<section class="page">
    ${secHead('02', 'FORGE', '생성기', '설명만 주면 플랫폼에 바로 임포트되는 JSON으로 벼려 드려요. 결과는 자동으로 규칙 검사를 거쳐요.')}
    <div class="card">
      <div class="seg big" data-seg="forge-kind">${Object.entries(FORGE_KINDS).map(([k, l]) => `<button type="button" class="${F.kind === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      ${F.kind !== 'trigger' ? `<div class="field"><span>대상 플랫폼</span>${platformSelect('forge-plat', F.platform, F.kind === 'lore')}</div>` : ''}
      ${form}
      ${pickerHtml(FORGE_TARGET[F.kind])}
      <div class="row end"><button class="btn primary" id="f-go" ${F.busy ? 'disabled' : ''}>${ICON.spark} ${F.busy ? '생성 중…' : '생성하기'}</button></div>
    </div>
    <div id="forge-out">${F.busy ? progressHtml(`${FORGE_KINDS[F.kind]} 벼리는 중`) : forgeResultHtml()}</div>
  </section>`;
  const root = V();
  bindPicker(root, FORGE_TARGET[F.kind]);
  bindSeg(root, 'forge-kind', v => { captureForge(); F.kind = v; F.result = null; viewForge(); });
  bindSeg(root, 'forge-plat', v => { F.platform = v; if (F.result) { rebuildForgeOutput(); $('#forge-out').innerHTML = forgeResultHtml(); bindForgeResult(); } });
  $('#f-go').onclick = () => runForge();
  bindForgeResult();
}
function captureForge() {
  const F = S.forge; const inp = F.inputs[F.kind] || (F.inputs[F.kind] = {});
  inp.brief = $('#f-brief')?.value ?? inp.brief;
  if ($('#f-count')) inp.count = $('#f-count').value;
  if ($('#f-index')) inp.index = $('#f-index').checked;
}
async function runForge(revise = null) {
  const F = S.forge; captureForge();
  const inp = F.inputs[F.kind];
  if (!revise && !inp.brief?.trim()) return toast('설명을 입력해 주세요', 'err');
  let task;
  if (revise) task = G.reviseTask(FORGE_KINDS[F.kind], revise.json, revise.feedback, revise.issues);
  else if (F.kind === 'lore') task = G.lorebookTask({ platform: F.platform, brief: inp.brief, count: inp.count, index: inp.index !== false });
  else if (F.kind === 'regex') task = G.regexTask({ platform: F.platform, brief: inp.brief });
  else task = G.triggerTask({ brief: inp.brief });
  F.busy = true; viewForge();
  try {
    const raw = await runTask(task, 'gen', progDelta, FORGE_TARGET[F.kind]);
    const ai = G.extractJson(raw);
    F.result = { ai, raw, kind: F.kind };
    rebuildForgeOutput();
  } catch (e) {
    F.result = F.result && revise ? F.result : null;
    toast(e.message, 'err');
    F.lastError = e.message;
  } finally { F.busy = false; if (S.tab === 'forge') viewForge(); }
}
function rebuildForgeOutput() {
  const F = S.forge, r = F.result; if (!r) return;
  const ai = r.ai;
  if (r.kind === 'lore') {
    const entries = ai.entries || (Array.isArray(ai) ? ai : []);
    r.notes = ai.notes;
    r.outputs = F.platform === 'both'
      ? { st: C.toStWorldInfo(entries), risu: C.toRisuLorebook(entries) }
      : { [F.platform]: F.platform === 'st' ? C.toStWorldInfo(entries) : C.toRisuLorebook(entries) };
  } else if (r.kind === 'regex') {
    const rules = (ai.rules || []).map(x => ({ ...x }));
    r.notes = ai.notes; r.sample = ai.sample;
    if (F.platform === 'st') r.outputs = { st: C.stRegexList(rules) };
    else {
      r.warnings = [];
      const conv = rules.map(x => { if ((x.kind || 'display') === 'display' && /<[a-z]/i.test(x.out)) { const o = C.toRisuOut(x.out); r.warnings.push(...o.warnings); return { ...x, out: o.out }; } return x; });
      r.outputs = { risu: C.risuRegexFile(conv) };
    }
  } else {
    r.notes = ai.notes; r.buttons = ai.buttons;
    r.outputs = { risu: ai.triggers || (Array.isArray(ai) ? ai : []) };
  }
  r.texts = Object.fromEntries(Object.entries(r.outputs).map(([k, v]) => [k, JSON.stringify(v, null, 2)]));
  r.view = Object.keys(r.texts)[0];
  r.issues = L.lint(r.texts[r.view]).issues;
}
function forgeResultHtml() {
  const F = S.forge, r = F.result;
  if (!r) return F.lastError ? `<div class="card error-card"><b>생성 실패</b><p>${esc(F.lastError)}</p></div>` : '';
  const keys = Object.keys(r.texts);
  return `<div class="card result">
    <div class="result-head"><div class="sec-label"><span class="en">OUTPUT</span></div><h2>${FORGE_KINDS[r.kind]} 결과</h2>
      ${keys.length > 1 ? `<div class="seg small" data-seg="forge-view">${keys.map(k => `<button type="button" class="${r.view === k ? 'on' : ''}" data-v="${k}">${k === 'st' ? '실리 월드인포' : '리스 로어북'}</button>`).join('')}</div>` : ''}</div>
    ${r.notes ? `<div class="notes">${renderMd(r.notes).html}</div>` : ''}
    ${r.buttons ? `<div class="notes"><b>버튼 예시</b><pre class="inline-code">${esc(r.buttons)}</pre></div>` : ''}
    ${(r.warnings || []).length ? `<ul class="conv-warn">${[...new Set(r.warnings)].map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="lint-box" id="forge-lint">${issuesHtml(r.issues)}</div>
    <label class="field"><span>JSON (직접 고쳐도 돼요 — 고친 내용으로 검사·저장돼요)</span><textarea id="forge-json" class="code-area" rows="14" spellcheck="false">${esc(r.texts[r.view])}</textarea></label>
    <div class="row wrap">
      <button class="btn" id="fr-lint">${ICON.lint} 다시 검사</button>
      ${r.kind === 'regex' && r.sample ? `<button class="btn" id="fr-prev">${ICON.eye} 렌더 미리보기</button>` : ''}
      <button class="btn" id="fr-copy">${ICON.copy} 복사</button>
      <button class="btn" id="fr-save">${ICON.vault} 보관</button>
      <button class="btn primary" id="fr-dl">${ICON.download} JSON 받기</button>
    </div>
    <div class="revise">
      <label class="field"><span>수정 요청</span><textarea id="fr-fb" rows="3" placeholder="예) 엔트리 3번 키워드를 더 구체적으로 / 오류만 고쳐줘 (비워두면 검사 결과의 문제만 고쳐요)"></textarea></label>
      <div class="row end"><button class="btn" id="fr-revise">${ICON.wand} 수정 요청 보내기</button></div>
    </div>
  </div>`;
}
function bindForgeResult() {
  const F = S.forge, r = F.result; if (!r || F.busy) return;
  const root = $('#forge-out');
  bindSeg(root, 'forge-view', v => { r.texts[r.view] = $('#forge-json').value; r.view = v; r.issues = L.lint(r.texts[v]).issues; root.innerHTML = forgeResultHtml(); bindForgeResult(); });
  const ta = $('#forge-json');
  ta.addEventListener('input', () => { r.texts[r.view] = ta.value; });
  $('#fr-lint').onclick = () => { r.issues = L.lint(ta.value).issues; $('#forge-lint').innerHTML = issuesHtml(r.issues); };
  $('#fr-copy').onclick = () => copyText(ta.value);
  const fname = () => `${safeName(curProject().name)}_${FORGE_KINDS[r.kind]}_${r.view === 'st' ? '실리' : '리스'}.json`;
  $('#fr-dl').onclick = () => { try { JSON.parse(ta.value); download(fname(), ta.value); } catch (e) { toast('JSON 구문 오류: ' + e.message, 'err'); } };
  $('#fr-save').onclick = async () => { const t = await askTitle(`${FORGE_KINDS[r.kind]} — ${(F.inputs[r.kind].brief || '').slice(0, 18)}`); await saveArtifact({ kind: { lore: 'lorebook', regex: 'regex', trigger: 'trigger' }[r.kind], platform: r.view, title: t, content: ta.value, meta: r.sample ? { sample: r.sample } : {} }); };
  if ($('#fr-prev')) $('#fr-prev').onclick = () => { try { regexPreviewSheet(JSON.parse(ta.value), r.sample, r.view); } catch (e) { toast(e.message, 'err'); } };
  $('#fr-revise').onclick = () => {
    let cur = ta.value;
    try {
      const j = JSON.parse(ta.value);
      if (r.kind === 'lore') cur = JSON.stringify({ entries: C.loreEntries(j) }, null, 2);
      else if (r.kind === 'regex') cur = JSON.stringify({ rules: C.normalizeRegexJson(j).map(({ comment, in: i, out, flag }) => ({ comment, kind: 'display', in: i, out, flag })), sample: r.sample }, null, 2);
      else cur = JSON.stringify({ triggers: j, buttons: r.buttons }, null, 2);
    } catch {}
    runForge({ json: cur, feedback: $('#fr-fb').value.trim(), issues: issuesText(r.issues) });
  };
}

// ───────────────────────── 렌더 미리보기 시트 ─────────────────────────
function regexPreviewSheet(json, sample, platform) {
  const rules = C.normalizeRegexJson(json);
  const plat = platform || rules[0]?.platform || 'risu';
  const body = `<label class="field"><span>샘플 출력 (정규식이 걸릴 AI 출력 텍스트)</span><textarea id="rp-sample" rows="5" class="code-area" spellcheck="false">${esc(sample || '')}</textarea></label>
    <div class="frame-tools">${platformSelect('rp-plat', plat)}<span class="grow"></span><span class="note">${plat === 'risu' ? '리스처럼 남은 줄바꿈은 &lt;br&gt;로 렌더돼요' : ''}</span></div>
    <div class="frame-wrap"><iframe id="rp-frame" sandbox="" title="미리보기"></iframe></div><ul class="conv-warn" id="rp-err"></ul>`;
  openSheet({
    title: '정규식 렌더 미리보기', wide: true, body, onMount: (b) => {
      let p = plat;
      const draw = () => {
        const r = C.renderSample($('#rp-sample', b).value, rules, p);
        $('#rp-frame', b).srcdoc = C.previewDoc(r.html);
        $('#rp-err', b).innerHTML = r.errors.map(e => `<li>${esc(e)}</li>`).join('');
      };
      bindSeg(b, 'rp-plat', v => { p = v; draw(); });
      $('#rp-sample', b).addEventListener('input', debounce(draw, 250));
      draw();
    }
  });
}
function htmlPreviewSheet(html) {
  openSheet({
    title: 'HTML 미리보기', wide: true,
    body: `<div class="frame-tools"><div class="seg small" data-seg="hp-bg"><button class="on" data-v="dark">어두운 배경</button><button data-v="light">밝은 배경</button></div></div><div class="frame-wrap"><iframe id="hp-frame" sandbox="" title="미리보기"></iframe></div>`,
    onMount: (b) => { const draw = (bg) => $('#hp-frame', b).srcdoc = C.previewDoc(html, { bg }); bindSeg(b, 'hp-bg', draw); draw('dark'); }
  });
}

// ───────────────────────── 3. 상태창 스튜디오 ─────────────────────────
function viewStudio() {
  const T = S.studio;
  T.platform = T.platform || defaultPlatform();
  const inp = T.inputs;
  V().innerHTML = `<section class="page">
    ${secHead('03', 'STUDIO', '상태창 스튜디오', '컨셉을 주면 세계관에서 출발한 상태창을 설계하고, 실제 플랫폼처럼 정규식을 돌려 미리 보여 드려요.')}
    <div class="card">
      <div class="field"><span>대상 플랫폼</span>${platformSelect('st-plat', T.platform)}</div>
      <label class="field"><span>컨셉 · 세계관 · 분위기</span><textarea id="s-brief" rows="5" placeholder="예) 조선 무속 호러 로맨스. 악신의 저주를 받은 신부, 도깨비 수호자. 먹·한지·붉은 실 느낌. 날짜/시간/장소/점괘/오염도/조각 수집 표시">${esc(inp.brief || '')}</textarea></label>
      <div class="row wrap">
        <label class="field inline"><span>태그</span><input id="s-tag" placeholder="ABST" value="${esc(inp.tag || '')}"></label>
        <label class="field inline grow"><span>필드 (선택)</span><input id="s-fields" placeholder="이름, 날짜, 장소, 호감도, 소지품(칩)…" value="${esc(inp.fields || '')}"></label>
      </div>
      <label class="field"><span>분위기 키워드 (선택)</span><input id="s-mood" placeholder="한지 질감, 먹번짐, 은은한 붉은 발광" value="${esc(inp.mood || '')}"></label>
      ${pickerHtml('ui')}
      <div class="row between wrap"><button class="btn ghost" id="s-import">${ICON.upload} 기존 정규식 불러와 미리보기</button><button class="btn primary" id="s-go" ${T.busy ? 'disabled' : ''}>${ICON.spark} ${T.busy ? '디자인 중…' : '디자인 생성'}</button></div>
    </div>
    <div id="studio-out">${T.busy ? progressHtml('상태창 디자인 중 — 길게 걸릴 수 있어요') : studioResultHtml()}</div>
  </section>`;
  const root = V();
  bindPicker(root, 'ui');
  bindSeg(root, 'st-plat', v => { T.platform = v; if (T.spec) { refreshStudio(true); } });
  $('#s-go').onclick = () => runStudio();
  $('#s-import').onclick = studioImportSheet;
  bindStudioResult();
}
function captureStudio() {
  const i = S.studio.inputs;
  i.brief = $('#s-brief')?.value ?? i.brief; i.tag = $('#s-tag')?.value ?? i.tag; i.fields = $('#s-fields')?.value ?? i.fields; i.mood = $('#s-mood')?.value ?? i.mood;
}
async function runStudio(revise = null) {
  const T = S.studio; captureStudio();
  if (!revise && !T.inputs.brief?.trim()) return toast('컨셉을 입력해 주세요', 'err');
  const task = revise ? G.reviseTask('상태창 UI', revise.json, revise.feedback, revise.issues)
    : G.uiTask({ platform: T.platform, brief: T.inputs.brief, tag: T.inputs.tag?.trim(), fields: T.inputs.fields, mood: T.inputs.mood });
  T.busy = true; viewStudio();
  try {
    const raw = await runTask(task, 'ui', progDelta, 'ui');
    const spec = G.extractJson(raw);
    if (!Array.isArray(spec.rules) || !spec.rules.length) throw new Error('응답에 정규식(rules)이 없어요. 다시 시도해 주세요.');
    T.spec = spec; T.lastError = null;
  } catch (e) { toast(e.message, 'err'); T.lastError = e.message; }
  finally { T.busy = false; if (S.tab === 'studio') viewStudio(); }
}
function studioExport(platform) {
  const T = S.studio; const rules = T.spec.rules.map(r => ({ kind: 'display', ...r }));
  if (platform === 'st') return { json: C.stRegexList(rules), warnings: [] };
  const warnings = [];
  const conv = rules.map(r => { const o = C.toRisuOut(r.out); warnings.push(...o.warnings); return { ...r, out: o.out }; });
  return { json: C.risuRegexFile(conv), warnings: [...new Set(warnings)] };
}
function studioResultHtml() {
  const T = S.studio, sp = T.spec;
  if (!sp) return T.lastError ? `<div class="card error-card"><b>생성 실패</b><p>${esc(T.lastError)}</p></div>` : '';
  const exp = studioExport(T.platform);
  T.warnings = exp.warnings;
  T.issues = L.lint(JSON.stringify(exp.json)).issues.concat(L.lintText(sp.promptFormat || '', '프롬프트 포맷'));
  const pane = T.pane;
  return `<div class="card result studio-result">
    <div class="result-head"><div class="sec-label"><span class="en">PREVIEW</span></div><h2>${esc(sp.name || '상태창')}</h2>${sp.concept ? `<p class="concept">${esc(sp.concept)}</p>` : ''}</div>
    <div class="frame-tools">
      <div class="seg small" data-seg="s-width">${[360, 412, 600].map(w => `<button type="button" class="${T.width === w ? 'on' : ''}" data-v="${w}">${w}</button>`).join('')}</div>
      <div class="seg small" data-seg="s-bg"><button type="button" class="${T.bg === 'dark' ? 'on' : ''}" data-v="dark">어둡게</button><button type="button" class="${T.bg === 'light' ? 'on' : ''}" data-v="light">밝게</button></div>
      <span class="grow"></span><span class="note">${T.platform === 'risu' ? '리스 변환본(한 줄 압축)으로 렌더' : '실리 방식으로 렌더'}</span>
    </div>
    <div class="frame-stage"><div class="frame-wrap" style="width:${T.width}px"><iframe id="s-frame" sandbox="" title="상태창 미리보기"></iframe></div></div>
    <ul class="conv-warn" id="s-err">${T.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    <div class="lint-box">${issuesHtml(T.issues, { compact: true })}</div>
    <div class="seg small tabs-inline" data-seg="s-pane">${[['rules', '정규식 원본'], ['sample', '샘플 출력'], ['format', '프롬프트 포맷'], ['notes', '설명']].map(([k, l]) => `<button type="button" class="${pane === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
    <div id="s-pane-body">${studioPaneHtml()}</div>
    <div class="row wrap">
      <button class="btn" id="s-copyfmt">${ICON.copy} 프롬프트 포맷 복사</button>
      <button class="btn" id="s-save">${ICON.vault} 보관</button>
      <button class="btn ${T.platform === 'risu' ? 'primary' : ''}" id="s-dl-risu">${ICON.download} 리스용 받기</button>
      <button class="btn ${T.platform === 'st' ? 'primary' : ''}" id="s-dl-st">${ICON.download} 실리용 받기</button>
    </div>
    <div class="revise">
      <label class="field"><span>수정 요청</span><textarea id="s-fb" rows="3" placeholder="예) 헤더를 더 묵직하게 / 칩 색을 붉은 실 느낌으로 / 소지금 섹션을 게이지로"></textarea></label>
      <div class="row end"><button class="btn" id="s-revise">${ICON.wand} 수정 요청 보내기</button></div>
    </div>
  </div>`;
}
function studioPaneHtml() {
  const T = S.studio, sp = T.spec;
  if (T.pane === 'rules') return `<label class="field"><span>정규식 원본 [{comment, in, out, flag}] — 고치면 미리보기에 바로 반영돼요</span><textarea id="s-rules" class="code-area" rows="12" spellcheck="false">${esc(JSON.stringify(sp.rules, null, 2))}</textarea></label>`;
  if (T.pane === 'sample') return `<label class="field"><span>샘플 출력</span><textarea id="s-sample" class="code-area" rows="9" spellcheck="false">${esc(sp.sample || '')}</textarea></label>`;
  if (T.pane === 'format') return `<label class="field"><span>봇 프롬프트에 넣을 출력 지시문</span><textarea id="s-format" class="code-area" rows="9" spellcheck="false">${esc(sp.promptFormat || '')}</textarea></label>`;
  return `<div class="notes">${renderMd(sp.notes || '(설명 없음)').html}</div>`;
}
function drawStudio() {
  const T = S.studio, sp = T.spec; const f = $('#s-frame'); if (!f || !sp) return;
  const rules = T.platform === 'risu' ? C.normalizeRegexJson(studioExport('risu').json) : sp.rules;
  const r = C.renderSample(sp.sample || '', rules, T.platform, sp.vars || {});
  f.srcdoc = C.previewDoc(r.html, { bg: T.bg });
  const err = $('#s-err'); if (err) err.innerHTML = T.warnings.concat(r.errors).map(w => `<li>${esc(w)}</li>`).join('');
}
function refreshStudio(full = false) {
  if (full) { $('#studio-out').innerHTML = studioResultHtml(); bindStudioResult(); }
  else drawStudio();
}
function bindStudioResult() {
  const T = S.studio; if (!T.spec || T.busy) return;
  const root = $('#studio-out');
  bindSeg(root, 's-width', v => { T.width = +v; $('.frame-wrap', root).style.width = v + 'px'; });
  bindSeg(root, 's-bg', v => { T.bg = v; drawStudio(); });
  bindSeg(root, 's-pane', v => { T.pane = v; $('#s-pane-body').innerHTML = studioPaneHtml(); bindStudioPane(); });
  bindStudioPane();
  $('#s-copyfmt').onclick = () => copyText(T.spec.promptFormat || '');
  $('#s-dl-risu').onclick = () => download(`${safeName(T.spec.name || curProject().name)}_상태창_리스.json`, JSON.stringify(studioExport('risu').json, null, 2));
  $('#s-dl-st').onclick = () => download(`${safeName(T.spec.name || curProject().name)}_상태창_실리.json`, JSON.stringify(studioExport('st').json, null, 2));
  $('#s-save').onclick = async () => { const t = await askTitle(T.spec.name || '상태창'); await saveArtifact({ kind: 'ui', platform: T.platform, title: t, content: JSON.stringify(T.spec, null, 2), meta: { sample: T.spec.sample } }); };
  $('#s-revise').onclick = () => runStudio({ json: JSON.stringify(T.spec, null, 2), feedback: $('#s-fb').value.trim(), issues: issuesText(T.issues || []) });
  drawStudio();
}
function bindStudioPane() {
  const T = S.studio;
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('input', debounce(() => fn(el.value), 350)); };
  on('#s-rules', v => { try { T.spec.rules = JSON.parse(v); $('#s-rules').classList.remove('bad'); const e = studioExport(T.platform); T.warnings = e.warnings; drawStudio(); } catch { $('#s-rules').classList.add('bad'); } });
  on('#s-sample', v => { T.spec.sample = v; drawStudio(); });
  on('#s-format', v => { T.spec.promptFormat = v; });
}
function studioImportSheet() {
  openSheet({
    title: '기존 정규식 불러오기', wide: true,
    body: `<p class="note">리스 정규식 파일, 실리 정규식(단일/목록) 모두 돼요. 불러온 뒤 스튜디오에서 미리보기·검사·플랫폼 변환·수정 요청을 할 수 있어요.</p>
      <label class="field"><span>정규식 JSON</span><textarea id="si-json" class="code-area" rows="8" spellcheck="false"></textarea></label>
      <div class="row"><button class="btn ghost small" id="si-file">${ICON.upload} 파일에서 열기</button></div>
      <label class="field"><span>샘플 출력 (정규식이 걸리는 AI 출력)</span><textarea id="si-sample" class="code-area" rows="5" spellcheck="false"></textarea></label>
      <div class="row end"><button class="btn primary" id="si-ok">${ICON.check} 불러오기</button></div>`,
    onMount: (b, close) => {
      $('#si-file', b).onclick = async () => { const f = await readFile('.json'); if (f) $('#si-json', b).value = f.text; };
      $('#si-ok', b).onclick = () => {
        try {
          const rules = C.normalizeRegexJson(JSON.parse($('#si-json', b).value));
          S.studio.platform = rules[0]?.platform || S.studio.platform;
          S.studio.spec = { name: rules[0]?.comment || '불러온 상태창', concept: '', rules: rules.map(({ comment, in: i, out, flag }) => ({ comment, in: i, out, flag })), sample: $('#si-sample', b).value, promptFormat: '', notes: '' };
          close(); viewStudio();
        } catch (e) { toast('JSON 오류: ' + e.message, 'err'); }
      };
    }
  });
}

// ───────────────────────── 4. 검사기 ─────────────────────────
function viewLint() {
  const T = S.lint;
  V().innerHTML = `<section class="page">
    ${secHead('05', 'INSPECT', '규칙 검사기', '확립된 규칙으로 정규식·트리거·로어북·카드·프롬프트·글꾸를 점검해요. AI 호출 없이 이 기기에서만 돌아가요.')}
    <div class="card">
      <div class="row wrap">
        <label class="field inline"><span>종류</span><select id="l-mode">${Object.entries(L.KINDS).map(([k, l]) => `<option value="${k}" ${T.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field inline"><span>HTML 기준 플랫폼</span>${platformSelect('l-plat', T.platform)}</div>
      </div>
      <label class="field"><span>검사할 내용 — JSON, HTML, 프롬프트 텍스트 무엇이든</span><textarea id="l-text" class="code-area" rows="12" spellcheck="false" placeholder="붙여넣거나 파일을 여세요">${esc(T.text)}</textarea></label>
      <div class="row between wrap"><button class="btn ghost" id="l-file">${ICON.upload} 파일 열기</button><button class="btn primary" id="l-go">${ICON.lint} 검사</button></div>
    </div>
    <div id="lint-out">${lintResultHtml()}</div>
  </section>`;
  const root = V();
  bindSeg(root, 'l-plat', v => T.platform = v);
  $('#l-mode').onchange = e => T.mode = e.target.value;
  $('#l-text').addEventListener('input', e => T.text = e.target.value);
  $('#l-file').onclick = async () => { const f = await readFile(); if (f) { T.text = f.text; $('#l-text').value = f.text; T.fileName = f.name; runLint(); } };
  $('#l-go').onclick = runLint;
  bindLintResult();
}
function runLint() {
  const T = S.lint; T.text = $('#l-text').value;
  T.result = L.lint(T.text, T.mode, T.platform); T.fixed = null;
  $('#lint-out').innerHTML = lintResultHtml(); bindLintResult();
}
function lintResultHtml() {
  const T = S.lint, r = T.result; if (!r) return '';
  const fixable = r.issues.some(i => i.fixable);
  return `<div class="card result">
    <div class="result-head"><div class="sec-label"><span class="en">REPORT</span></div><h2>${esc(L.KINDS[r.kind] || (r.kind === 'badjson' ? 'JSON 오류' : r.kind))}</h2></div>
    ${issuesHtml(r.issues)}
    <div class="row wrap">
      ${fixable ? `<button class="btn primary" id="l-fix">${ICON.wand} 자동 수정</button>` : ''}
      ${r.issues.some(i => i.level !== 'info') ? `<button class="btn" id="l-ask">${ICON.chat} 작업실에서 AI와 고치기</button>` : ''}
      ${r.kind !== 'badjson' && r.kind !== 'empty' ? `<button class="btn" id="l-save">${ICON.vault} 보관</button>` : ''}
    </div>
    ${T.fixed ? `<div class="divider"><span>자동 수정 결과</span></div><ul class="fix-notes">${T.fixed.notes.map(n => `<li>${ICON.check}<span>${esc(n)}</span></li>`).join('')}</ul>
      <textarea id="l-fixed" class="code-area" rows="10" spellcheck="false">${esc(T.fixed.text)}</textarea>
      <div class="row wrap"><button class="btn" id="l-fcopy">${ICON.copy} 복사</button><button class="btn" id="l-fuse">${ICON.refresh} 이걸로 다시 검사</button><button class="btn primary" id="l-fdl">${ICON.download} 받기</button></div>` : ''}
  </div>`;
}
function bindLintResult() {
  const T = S.lint, r = T.result; if (!r) return;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#l-fix', () => { try { T.fixed = L.autoFix(T.text, r.kind); $('#lint-out').innerHTML = lintResultHtml(); bindLintResult(); } catch (e) { toast(e.message, 'err'); } });
  on('#l-ask', () => { S.pendingPrompt = `아래 작업물을 검사기가 지적한 문제에 맞게 고쳐 주세요.\n\n[검사 결과]\n${issuesText(r.issues)}\n\n[작업물]\n\`\`\`\n${T.text}\n\`\`\``; setTab('chat'); });
  on('#l-save', async () => { const t = await askTitle(T.fileName || `${L.KINDS[r.kind] || '작업물'} ${fmtDate(Date.now())}`); await saveArtifact({ kind: kindFromLint(r.kind), platform: /^st/.test(r.kind) ? 'st' : 'risu', title: t, content: T.text }); });
  on('#l-fcopy', () => copyText($('#l-fixed').value));
  on('#l-fuse', () => { T.text = $('#l-fixed').value; $('#l-text').value = T.text; runLint(); });
  on('#l-fdl', () => { const isJson = /^\s*[\[{]/.test(T.fixed.text); download(T.fileName ? T.fileName.replace(/(\.\w+)?$/, '_fixed$1') : `fixed.${isJson ? 'json' : 'html'}`, $('#l-fixed').value, isJson ? 'application/json' : 'text/html'); });
}

// ───────────────────────── 5. 보관함 ─────────────────────────
async function viewVault() {
  const all = (await db.all('artifacts')).filter(a => S.vaultAll || a.projectId === S.pid).sort((a, b) => b.updatedAt - a.updatedAt);
  const pname = (id) => S.projects.find(p => p.id === id)?.name || '';
  V().innerHTML = `<section class="page">
    ${secHead('06', 'VAULT', '보관함', '같은 이름으로 저장하면 이전 내용은 버전 기록으로 쌓여요. 언제든 되돌릴 수 있어요.')}
    <div class="row between"><div class="seg small" data-seg="v-scope"><button type="button" class="${!S.vaultAll ? 'on' : ''}" data-v="cur">이 프로젝트</button><button type="button" class="${S.vaultAll ? 'on' : ''}" data-v="all">전체</button></div><button class="btn ghost small" id="v-import">${ICON.upload} 파일 가져오기</button></div>
    ${all.length ? `<div class="vault-grid">${all.map(a => `<button class="vault-card" data-aid="${a.id}">
        <div class="vc-top"><span class="kind k-${a.kind}">${KIND_LABEL[a.kind] || a.kind}</span><span class="plat-mini">${a.platform === 'st' ? '실리' : a.platform === 'risu' ? '리스' : ''}</span>${(a.history || []).length ? `<span class="ver">v${a.history.length + 1}</span>` : ''}</div>
        <b>${esc(a.title)}</b><small>${S.vaultAll ? esc(pname(a.projectId)) + ' · ' : ''}${fmtDate(a.updatedAt)} · ${(a.content.length / 1000).toFixed(1)}k자</small></button>`).join('')}</div>`
      : `<div class="empty-card">${ICON.vault}<p>아직 보관된 작업물이 없어요.<br>생성기·상태창·채팅 코드 블록에서 “보관”을 눌러 보세요.</p></div>`}
  </section>`;
  bindSeg(V(), 'v-scope', v => { S.vaultAll = v === 'all'; viewVault(); });
  $('#v-import').onclick = async () => {
    const f = await readFile(); if (!f) return;
    const d = L.detect(f.text);
    await saveArtifact({ kind: kindFromLint(d.kind), platform: /^st/.test(d.kind) ? 'st' : 'risu', title: f.name.replace(/\.\w+$/, ''), content: f.text });
    viewVault();
  };
  $$('.vault-card').forEach(el => el.onclick = () => artifactSheet(el.dataset.aid));
}
async function artifactSheet(id) {
  const a = await db.get('artifacts', id);
  const hist = a.history || [];
  const isUi = a.kind === 'ui';
  const body = `<div class="art-meta"><span class="kind k-${a.kind}">${KIND_LABEL[a.kind]}</span><span>${a.platform === 'st' ? '실리태번' : '리스AI'}</span><span>v${hist.length + 1}</span><span>${fmtDate(a.updatedAt)}</span></div>
    <label class="field"><span>이름</span><input id="a-title" value="${esc(a.title)}"></label>
    <label class="field"><span>내용</span><textarea id="a-content" class="code-area" rows="14" spellcheck="false">${esc(a.content)}</textarea></label>
    <div id="a-lint"></div>
    <div class="row wrap">
      <button class="btn" id="a-lintbtn">${ICON.lint} 검사</button>
      ${isUi ? `<button class="btn" id="a-studio">${ICON.studio} 스튜디오에서 열기</button>` : ''}
      ${a.kind === 'regex' ? `<button class="btn" id="a-prev">${ICON.eye} 렌더</button>` : ''}
      ${a.kind === 'html' || a.kind === 'board' ? `<button class="btn" id="a-hprev">${ICON.eye} 미리보기</button>` : ''}
      ${a.kind === 'board' ? `<button class="btn" id="a-board">${ICON.board} 글꾸에서 열기</button>` : ''}
      <button class="btn" id="a-copy">${ICON.copy} 복사</button>
      <button class="btn" id="a-dl">${ICON.download} 받기</button>
      <button class="btn primary" id="a-save">${ICON.check} 새 버전으로 저장</button>
    </div>
    ${hist.length ? `<div class="divider"><span>버전 기록</span></div><div class="list">${hist.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => `<div class="list-row"><div class="list-main"><b>v${i + 1}</b><small>${fmtDate(h.at)} · ${(h.content.length / 1000).toFixed(1)}k자</small></div><button class="btn small ghost" data-restore="${i}">되돌리기</button></div>`).join('')}</div>` : ''}
    <div class="row end"><button class="btn danger ghost" id="a-del">${ICON.trash} 삭제</button></div>`;
  openSheet({
    title: a.title, wide: true, body, onMount: (b, close) => {
      const ta = $('#a-content', b);
      $('#a-lintbtn', b).onclick = () => { const r = L.lint(isUi ? JSON.stringify(studioExportFrom(JSON.parse(ta.value), a.platform)) : ta.value, a.kind === 'board' ? 'board' : 'auto', a.platform); $('#a-lint', b).innerHTML = issuesHtml(r.issues, { compact: true }); };
      $('#a-copy', b).onclick = () => copyText(ta.value);
      $('#a-dl', b).onclick = () => { const json = /^\s*[\[{]/.test(ta.value); download(`${safeName(a.title)}.${isUi ? 'json' : json ? 'json' : a.kind === 'html' ? 'html' : 'txt'}`, isUi ? JSON.stringify(studioExportFrom(JSON.parse(ta.value), a.platform), null, 2) : ta.value, json ? 'application/json' : 'text/plain'); };
      $('#a-save', b).onclick = async () => {
        const title = $('#a-title', b).value.trim() || a.title;
        if (ta.value === a.content && title === a.title) return toast('바뀐 내용이 없어요');
        if (ta.value !== a.content) a.history = [...hist, { content: a.content, meta: a.meta, at: a.updatedAt }].slice(-30);
        a.content = ta.value; a.title = title; a.updatedAt = Date.now();
        await db.put('artifacts', a); toast('저장했어요'); close(); viewVault();
      };
      $('#a-del', b).onclick = async () => { if (!(await confirmSheet(`“${a.title}” 과 모든 버전을 삭제할까요?`, '삭제'))) return; await db.del('artifacts', a.id); close(); viewVault(); };
      b.addEventListener('click', async e => {
        const r = e.target.closest('[data-restore]'); if (!r) return;
        const h = hist[+r.dataset.restore]; ta.value = h.content; toast(`v${+r.dataset.restore + 1} 내용을 불러왔어요 — “새 버전으로 저장”을 누르면 확정돼요`);
      });
      if ($('#a-prev', b)) $('#a-prev', b).onclick = () => { try { regexPreviewSheet(JSON.parse(ta.value), a.meta?.sample || '', a.platform); } catch (e) { toast(e.message, 'err'); } };
      if ($('#a-hprev', b)) $('#a-hprev', b).onclick = () => htmlPreviewSheet(ta.value);
      if ($('#a-board', b)) $('#a-board', b).onclick = () => { S.board.spec = { title: a.title, html: ta.value, notes: '' }; close(); setTab('board'); };
      if ($('#a-studio', b)) $('#a-studio', b).onclick = () => { try { S.studio.spec = JSON.parse(ta.value); S.studio.platform = a.platform; close(); setTab('studio'); } catch (e) { toast(e.message, 'err'); } };
    }
  });
}
function studioExportFrom(spec, platform) {
  const keep = S.studio.spec; S.studio.spec = spec;
  try { return studioExport(platform).json; } finally { S.studio.spec = keep; }
}

// ───────────────────────── 설정 ─────────────────────────
function viewSettings() {
  const st = S.settings, p = st.active, c = st[p];
  const field = (key, label, type = 'text', ph = '', extra = '') => `<label class="field"><span>${label}</span><input data-k="${key}" type="${type}" value="${esc(c[key] ?? '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" ${extra}></label>`;
  let prov = '';
  if (p === 'vertex') {
    prov = `<div class="field"><span>모델 제공사</span><div class="seg small" data-seg="vx-pub"><button type="button" class="${c.publisher !== 'anthropic' ? 'on' : ''}" data-v="google">Gemini</button><button type="button" class="${c.publisher === 'anthropic' ? 'on' : ''}" data-v="anthropic">Claude (Vertex)</button></div></div>
      <div class="field"><span>인증 방식</span><div class="seg small" data-seg="vx-auth">${[['express', '익스프레스 키'], ['sa', '서비스 계정 JSON'], ['token', '액세스 토큰']].map(([v, l]) => `<button type="button" class="${c.auth === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${c.auth === 'express' ? field('apiKey', 'Vertex API 키 (익스프레스 모드)', 'password', 'AQ.… 또는 AIza…')
        : c.auth === 'sa' ? `<label class="field"><span>서비스 계정 키 JSON (브라우저에서 직접 서명해 토큰 발급 · 1시간마다 자동 갱신)</span><textarea data-k="saJson" class="code-area" rows="5" spellcheck="false" placeholder='{"type":"service_account","project_id":…}'>${esc(c.saJson || '')}</textarea></label><div class="row"><button class="btn ghost small" id="sa-file">${ICON.upload} 키 파일 열기</button></div>`
        : field('token', '액세스 토큰 (gcloud auth print-access-token · 약 1시간 유효)', 'password')}
      ${c.auth !== 'express' || c.publisher === 'anthropic' ? `<div class="row wrap">${field('project', '프로젝트 ID' + (c.auth === 'sa' ? ' (비우면 키 파일의 값)' : ''), 'text', 'my-gcp-project')}${field('location', '리전', 'text', 'global / us-central1 / us-east5')}</div>` : ''}`;
  } else if (p === 'compat') {
    prov = field('baseUrl', 'API 주소 (/chat/completions 앞까지)', 'url', 'https://openrouter.ai/api/v1') + field('apiKey', 'API 키 (필요한 경우)', 'password');
  } else {
    prov = field('apiKey', 'API 키', 'password');
  }
  const sugg = p === 'vertex' ? P.MODEL_SUGGEST[c.publisher === 'anthropic' ? 'vertex_anthropic' : 'vertex_google'] : P.MODEL_SUGGEST[p];
  V().innerHTML = `<section class="page">
    ${secHead('00', 'SETUP', '설정', 'API 키와 작업 데이터는 이 기기의 브라우저 저장소에만 보관돼요.')}
    <div class="card">
      <div class="card-title">${ICON.link}<h2>AI 연결</h2></div>
      <div class="prov-grid">${Object.entries(P.PROVIDERS).map(([k, v]) => `<button type="button" class="prov ${p === k ? 'on' : ''}" data-prov="${k}"><b>${v.label}</b>${k === 'vertex' ? '<em>주력</em>' : ''}</button>`).join('')}</div>
      <p class="note">${esc(P.PROVIDERS[p].hint)}</p>
      ${prov}
      <label class="field"><span>모델</span><div class="input-btn"><input data-k="model" list="model-list" value="${esc(c.model || '')}" placeholder="모델 이름" spellcheck="false"><button class="btn small" id="model-load" type="button">${ICON.list} 목록</button></div><datalist id="model-list">${(sugg || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
      <div class="row wrap">
        <label class="field inline grow"><span>온도 <b id="temp-v">${st.temperature}</b></span><input type="range" min="0" max="2" step="0.05" data-g="temperature" value="${st.temperature}"></label>
        <label class="field inline"><span>최대 출력 토큰</span><input type="number" min="256" step="256" data-g="maxTokens" value="${st.maxTokens}"></label>
        <label class="field inline"><span>대화 기억 (메시지 수)</span><input type="number" min="2" max="200" data-g="history" value="${st.history}"></label>
      </div>
      <div class="row end"><span class="note" id="test-out"></span><button class="btn primary" id="test-btn">${ICON.spark} 연결 테스트</button></div>
    </div>

    <div class="card">
      <div class="card-title">${ICON.book}<h2>지식 팩</h2><span class="grow"></span><span class="count">${S.kb.modules.filter(m => m.enabled).length}/${S.kb.modules.length}</span></div>
      <p class="note">켜진 지식만 AI에 전달돼요. 범위(채팅/생성/상태창/글꾸)에 맞는 기능에서만 쓰여요.</p>
      <div class="kb-list">${S.kb.modules.map((m, i) => `<div class="kb-row ${m.enabled ? '' : 'off'}">
        <label class="switch"><input type="checkbox" data-kb-toggle="${i}" ${m.enabled ? 'checked' : ''}><i></i></label>
        <button class="kb-main" data-kb-edit="${i}"><b>${esc(m.title)}</b><small>${(m.scope || []).map(s => ({ chat: '채팅', gen: '생성', ui: '상태창', board: '글꾸', lint: '검사' }[s])).join(' · ')} · ${m.content.length}자</small></button>
        <button class="icon-btn" data-kb-edit="${i}" aria-label="편집">${ICON.edit}</button></div>`).join('')}</div>
      <div class="row wrap"><button class="btn ghost small" id="kb-add">${ICON.plus} 새 지식</button><button class="btn ghost small" id="kb-export">${ICON.download} 내보내기</button><button class="btn ghost small" id="kb-import">${ICON.upload} 가져오기</button><span class="grow"></span><button class="btn ghost small" id="kb-reset">${ICON.refresh} 기본값 복원</button></div>
    </div>

    ${customsCardHtml()}

    <div class="card">
      <div class="card-title">${ICON.spark}<h2>파트너 페르소나</h2></div>
      <p class="note">AI의 화법·태도. 비워두면 기본 페르소나를 써요. 멜 페르소나를 그대로 붙여넣어도 돼요.</p>
      <textarea id="persona" rows="7" placeholder="${esc(DEFAULT_PERSONA)}">${esc(st.persona || '')}</textarea>
    </div>

    <div class="card">
      <div class="card-title">${ICON.folder}<h2>데이터</h2></div>
      <label class="check"><input type="checkbox" id="bk-keys"><span>백업에 API 키 포함 (다른 기기로 옮길 때만)</span></label>
      <div class="row wrap"><button class="btn" id="bk-export">${ICON.download} 전체 백업</button><button class="btn" id="bk-import">${ICON.upload} 백업 복원</button><span class="grow"></span><button class="btn danger ghost" id="bk-wipe">${ICON.trash} 전체 초기화</button></div>
      <p class="note mono">Bot Atelier v${VERSION} · IndexedDB botAtelierDB</p>
    </div>
  </section>`;
  const root = V();
  $$('.prov', root).forEach(b => b.onclick = () => { st.active = b.dataset.prov; saveSettings(); viewSettings(); renderChrome(); });
  bindSeg(root, 'vx-pub', v => { c.publisher = v; c.model = P.MODEL_SUGGEST[v === 'anthropic' ? 'vertex_anthropic' : 'vertex_google'][0]; if (v === 'anthropic' && c.auth === 'express') c.auth = 'sa'; if (v === 'anthropic' && (!c.location || c.location === 'global')) c.location = 'us-east5'; saveSettings(); viewSettings(); });
  bindSeg(root, 'vx-auth', v => { c.auth = v; saveSettings(); viewSettings(); });
  $$('[data-k]', root).forEach(el => el.addEventListener('input', () => { c[el.dataset.k] = el.value; saveSettings(); }));
  $$('[data-g]', root).forEach(el => el.addEventListener('input', () => { st[el.dataset.g] = el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value; if (el.dataset.g === 'temperature') $('#temp-v').textContent = el.value; saveSettings(); }));
  if ($('#sa-file')) $('#sa-file').onclick = async () => { const f = await readFile('.json'); if (f) { c.saJson = f.text; try { const j = JSON.parse(f.text); if (j.project_id && !c.project) c.project = j.project_id; } catch {} saveSettings(); viewSettings(); toast('서비스 계정 키를 불러왔어요'); } };
  $('#model-load').onclick = async () => {
    try { const list = await P.listModels(st); $('#model-list').innerHTML = list.map(m => `<option value="${esc(m)}">`).join(''); toast(`모델 ${list.length}개 — 입력칸을 눌러 고르세요`); $('[data-k="model"]').focus(); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#test-btn').onclick = async () => {
    const out = $('#test-out'); out.textContent = '연결 중…'; out.className = 'note';
    const t0 = performance.now();
    try {
      const r = await P.chat({ system: 'You are a connection test.', messages: [{ role: 'user', content: '연결 확인. "연결 성공"이라고만 답해.' }], cfg: { ...st, maxTokens: Math.max(1024, Math.min(st.maxTokens, 2048)) } });
      out.textContent = `✓ ${Math.round(performance.now() - t0)}ms · “${r.trim().slice(0, 30)}”`; out.className = 'note ok';
    } catch (e) { out.textContent = e.message; out.className = 'note err'; }
  };
  bindCustomsCard(root);
  $('#persona').addEventListener('input', e => { st.persona = e.target.value; saveSettings(); });
  root.addEventListener('change', async e => {
    const t = e.target.closest('[data-kb-toggle]'); if (!t) return;
    S.kb.modules[+t.dataset.kbToggle].enabled = t.checked; await saveKb(); viewSettings();
  });
  $$('[data-kb-edit]', root).forEach(b => b.onclick = () => kbEditSheet(+b.dataset.kbEdit));
  $('#kb-add').onclick = () => { S.kb.modules.push({ id: 'custom-' + Date.now().toString(36), title: '새 지식', enabled: true, scope: ['chat', 'gen', 'ui'], content: '' }); kbEditSheet(S.kb.modules.length - 1, true); };
  $('#kb-export').onclick = () => download('봇아틀리에_지식팩.json', JSON.stringify({ type: 'bot-atelier-knowledge', version: 1, modules: S.kb.modules }, null, 2));
  $('#kb-import').onclick = async () => {
    const f = await readFile('.json'); if (!f) return;
    try { const j = JSON.parse(f.text); const mods = j.modules || j; if (!Array.isArray(mods)) throw new Error('modules 배열이 없어요');
      for (const m of mods) { const i = S.kb.modules.findIndex(x => x.id === m.id); if (i >= 0) S.kb.modules[i] = m; else S.kb.modules.push(m); }
      await saveKb(); viewSettings(); toast(`지식 ${mods.length}개를 가져왔어요`);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#kb-reset').onclick = async () => { if (!(await confirmSheet('기본 지식을 처음 상태로 되돌릴까요? (직접 추가한 지식은 유지돼요)', '복원', false))) return; S.kb.modules = structuredClone(DEFAULT_MODULES).concat(S.kb.modules.filter(m => m.id.startsWith('custom-'))); S.kb.removed = []; await saveKb(); viewSettings(); };
  $('#bk-export').onclick = async () => {
    const data = await db.dump();
    if (!$('#bk-keys').checked) data.kv = data.kv.map(v => v.id !== 'settings' ? v : stripKeys(v));
    download(`봇아틀리에_백업_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ type: 'bot-atelier-backup', version: VERSION, at: Date.now(), data }, null, 2));
  };
  $('#bk-import').onclick = async () => {
    const f = await readFile('.json'); if (!f) return;
    try { const j = JSON.parse(f.text); if (j.type !== 'bot-atelier-backup') throw new Error('봇 아틀리에 백업 파일이 아니에요');
      if (!(await confirmSheet('현재 데이터를 백업 내용으로 덮어쓸까요?', '복원'))) return;
      const keepKeys = S.settings;
      await db.restore(j.data);
      const ns = await db.get('kv', 'settings'); if (ns && !hasKeys(ns)) await db.put('kv', mergeKeys(ns, keepKeys));
      location.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#bk-wipe').onclick = async () => {
    if (!(await confirmSheet('모든 프로젝트·대화·보관함·설정을 지울까요? 되돌릴 수 없어요.', '전부 삭제'))) return;
    for (const s of ['projects', 'threads', 'artifacts', 'kv']) await db.clear(s);
    location.reload();
  };
}
const KEY_FIELDS = ['apiKey', 'saJson', 'token'];
function stripKeys(s) { const c = structuredClone(s); for (const p of Object.keys(P.PROVIDERS)) if (c[p]) for (const k of KEY_FIELDS) if (k in c[p]) c[p][k] = ''; return c; }
function hasKeys(s) { return Object.keys(P.PROVIDERS).some(p => KEY_FIELDS.some(k => s[p]?.[k])); }
function mergeKeys(ns, old) { const c = structuredClone(ns); for (const p of Object.keys(P.PROVIDERS)) for (const k of KEY_FIELDS) if (old[p]?.[k] && c[p]) c[p][k] = old[p][k]; return c; }

function kbEditSheet(i, isNew = false) {
  const m = S.kb.modules[i];
  const scopes = [['chat', '채팅'], ['gen', '생성기'], ['ui', '상태창'], ['board', '글꾸'], ['lint', '검사']];
  openSheet({
    title: isNew ? '새 지식' : '지식 편집', wide: true,
    body: `<label class="field"><span>제목</span><input id="kb-title" value="${esc(m.title)}"></label>
      <div class="field"><span>쓰이는 곳</span><div class="checks">${scopes.map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${(m.scope || []).includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <label class="field"><span>내용 (- 로 시작하는 짧은 규칙 목록 권장)</span><textarea id="kb-content" class="code-area" rows="14">${esc(m.content)}</textarea></label>
      <div class="row between"><button class="btn danger ghost" id="kb-del">${ICON.trash} 삭제</button><button class="btn primary" id="kb-save">${ICON.check} 저장</button></div>`,
    onMount: (b, close) => {
      $('#kb-save', b).onclick = async () => {
        m.title = $('#kb-title', b).value.trim() || m.title;
        m.scope = $$('.checks input:checked', b).map(x => x.value);
        m.content = $('#kb-content', b).value;
        S._kbSaved = true; await saveKb(); close(); viewSettings(); toast('지식을 저장했어요');
      };
      $('#kb-del', b).onclick = async () => {
        if (!(await confirmSheet(`“${m.title}” 지식을 삭제할까요?`, '삭제'))) return;
        S.kb.modules.splice(i, 1);
        if (!m.id.startsWith('custom-')) S.kb.removed = [...(S.kb.removed || []), m.id];
        S._kbSaved = true; await saveKb(); close(); viewSettings();
      };
    },
    onClose: () => { if (isNew && !S._kbSaved) S.kb.modules = S.kb.modules.filter(x => x !== m); S._kbSaved = false; }
  });
}


// ───────────────────────── 커스텀 프롬프트 ─────────────────────────
const TARGETS = { chat: '작업실', lore: '로어북', regex: '정규식', trigger: '트리거', ui: '상태창', board: '글꾸' };
function customsFor(target) {
  const list = S.settings.customs || [];
  const ap = S.settings.applied?.[target];
  return list.filter(c => (c.targets || []).includes(target) && (ap ? ap.includes(c.id) : c.auto !== false));
}
function pickerHtml(target) {
  const list = (S.settings.customs || []).filter(c => (c.targets || []).includes(target));
  const on = new Set(customsFor(target).map(c => c.id));
  return `<div class="picker" data-picker="${target}">
    <span class="picker-label">${ICON.scroll}<span>커스텀 프롬프트</span></span>
    ${list.map(c => `<button type="button" class="pchip ${on.has(c.id) ? 'on' : ''}" data-pc="${c.id}" title="${esc(c.content.slice(0, 120))}">${c.mode === 'priority' ? '<i>우선</i>' : ''}<span>${esc(c.title)}</span></button>`).join('')}
    <button type="button" class="pchip add" data-act="custom-new" data-target="${target}">${ICON.plus}<span>${list.length ? '추가' : '만들기'}</span></button>
  </div>`;
}
function bindPicker(root, target) {
  const el = $(`[data-picker="${target}"]`, root); if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pc]'); if (!b) return;
    const cur = customsFor(target).map(c => c.id);
    const id = b.dataset.pc;
    S.settings.applied = { ...(S.settings.applied || {}), [target]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
    saveSettings(); b.classList.toggle('on');
  });
}
function captureCurrent() {
  if (S.tab === 'forge' && $('#f-brief')) captureForge();
  if (S.tab === 'studio' && $('#s-brief')) captureStudio();
  if (S.tab === 'board' && $('#b-body')) captureBoard();
  if (S.tab === 'chat' && $('#prompt')?.value) S.pendingPrompt = $('#prompt').value;
}
function rerender() { captureCurrent(); const y = V().scrollTop; setTab(S.tab); V().scrollTop = y; }

function customEditSheet(id, presetTarget) {
  const isNew = !id;
  const c = isNew ? { id: 'cp-' + Date.now().toString(36), title: '', content: '', targets: presetTarget ? [presetTarget] : ['chat'], mode: 'append', auto: true }
    : structuredClone(S.settings.customs.find(x => x.id === id));
  openSheet({
    title: isNew ? '새 커스텀 프롬프트' : '커스텀 프롬프트 편집', wide: true,
    body: `<label class="field"><span>이름</span><input id="cp-title" value="${esc(c.title)}" placeholder="예) 무협 문체 가이드 / 내 상태창 취향 / 멜 페르소나"></label>
      <div class="field"><span>적용할 곳</span><div class="checks">${Object.entries(TARGETS).map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${c.targets.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="field"><span>방식</span><div class="seg small" data-seg="cp-mode"><button type="button" class="${c.mode !== 'priority' ? 'on' : ''}" data-v="append">추가 — 기본 규칙과 함께</button><button type="button" class="${c.mode === 'priority' ? 'on' : ''}" data-v="priority">우선 — 충돌 시 이 지시가 이김</button></div></div>
      <label class="check"><input type="checkbox" id="cp-auto" ${c.auto !== false ? 'checked' : ''}><span>새로 만들면 해당 기능에서 자동으로 켜기</span></label>
      <label class="field"><span>프롬프트 내용</span><textarea id="cp-content" class="code-area" rows="14" spellcheck="false" placeholder="AI에게 그대로 전달돼요. 출력 형식(JSON)은 앱이 따로 지정하므로 내용·스타일·취향 위주로 쓰면 좋아요.">${esc(c.content)}</textarea></label>
      <div class="row wrap"><button class="btn ghost small" id="cp-file">${ICON.upload} 파일에서 내용 불러오기</button><span class="grow"></span><span class="note mono" id="cp-len">${c.content.length}자</span></div>
      <div class="row between">${isNew ? '<span></span>' : `<button class="btn danger ghost" id="cp-del">${ICON.trash} 삭제</button>`}<button class="btn primary" id="cp-save">${ICON.check} 저장</button></div>`,
    onMount: (b, close) => {
      let mode = c.mode;
      bindSeg(b, 'cp-mode', v => mode = v);
      const ta = $('#cp-content', b);
      ta.addEventListener('input', () => $('#cp-len', b).textContent = ta.value.length + '자');
      $('#cp-file', b).onclick = async () => { const f = await readFile('.txt,.md,.json'); if (!f) return; ta.value = f.text; ta.dispatchEvent(new Event('input')); if (!$('#cp-title', b).value) $('#cp-title', b).value = f.name.replace(/\.\w+$/, ''); };
      $('#cp-save', b).onclick = async () => {
        c.title = $('#cp-title', b).value.trim() || '이름 없는 프롬프트';
        c.content = ta.value; c.mode = mode; c.auto = $('#cp-auto', b).checked;
        c.targets = $$('.checks input:checked', b).map(x => x.value);
        if (!c.content.trim()) return toast('내용을 입력해 주세요', 'err');
        if (!c.targets.length) return toast('적용할 곳을 하나 이상 골라 주세요', 'err');
        const list = S.settings.customs;
        const i = list.findIndex(x => x.id === c.id);
        if (i >= 0) list[i] = c; else list.push(c);
        if (isNew && c.auto) for (const t of c.targets) if (S.settings.applied[t]) S.settings.applied[t] = [...S.settings.applied[t], c.id];
        saveSettings(); close(); toast('커스텀 프롬프트를 저장했어요'); rerender();
      };
      if ($('#cp-del', b)) $('#cp-del', b).onclick = async () => {
        if (!(await confirmSheet(`“${c.title}” 프롬프트를 삭제할까요?`, '삭제'))) return;
        S.settings.customs = S.settings.customs.filter(x => x.id !== c.id);
        for (const t of Object.keys(S.settings.applied)) S.settings.applied[t] = S.settings.applied[t].filter(x => x !== c.id);
        saveSettings(); close(); rerender();
      };
    }
  });
}
function customsCardHtml() {
  const list = S.settings.customs || [];
  return `<div class="card">
    <div class="card-title">${ICON.scroll}<h2>커스텀 프롬프트</h2><span class="grow"></span><span class="count">${list.length}</span></div>
    <p class="note">내 프롬프트를 기능별로 적용해요. 각 화면의 “커스텀 프롬프트” 칩으로 그때그때 켜고 끌 수 있어요.</p>
    ${list.length ? `<div class="kb-list">${list.map(c => `<div class="kb-row"><button class="kb-main" data-cp-edit="${c.id}"><b>${c.mode === 'priority' ? '<span class="tag-pri">우선</span> ' : ''}${esc(c.title)}</b><small>${c.targets.map(t => TARGETS[t]).join(' · ')} · ${c.content.length}자</small></button><button class="icon-btn" data-cp-edit="${c.id}" aria-label="편집">${ICON.edit}</button></div>`).join('')}</div>` : '<div class="empty-mini">아직 없어요. 자주 쓰는 지시문·문체 가이드·페르소나를 등록해 보세요.</div>'}
    <div class="row wrap"><button class="btn ghost small" data-act="custom-new">${ICON.plus} 새 프롬프트</button><button class="btn ghost small" id="cp-import">${ICON.upload} 가져오기</button>${list.length ? `<button class="btn ghost small" id="cp-export">${ICON.download} 내보내기</button>` : ''}</div>
  </div>`;
}
function bindCustomsCard(root) {
  $$('[data-cp-edit]', root).forEach(b => b.onclick = () => customEditSheet(b.dataset.cpEdit));
  if ($('#cp-export', root)) $('#cp-export', root).onclick = () => download('봇아틀리에_커스텀프롬프트.json', JSON.stringify({ type: 'bot-atelier-prompts', version: 1, prompts: S.settings.customs }, null, 2));
  $('#cp-import', root).onclick = async () => {
    const f = await readFile('.json,.txt,.md'); if (!f) return;
    try {
      let items;
      if (/\.json$/i.test(f.name)) { const j = JSON.parse(f.text); items = j.prompts || j; if (!Array.isArray(items)) throw new Error('prompts 배열이 없어요'); }
      else items = [{ id: 'cp-' + Date.now().toString(36), title: f.name.replace(/\.\w+$/, ''), content: f.text, targets: ['chat'], mode: 'append', auto: true }];
      for (const it of items) {
        if (!it.id || !it.content) continue;
        const i = S.settings.customs.findIndex(x => x.id === it.id);
        if (i >= 0) S.settings.customs[i] = it; else S.settings.customs.push({ targets: ['chat'], mode: 'append', auto: true, ...it });
      }
      saveSettings(); viewSettings(); toast(`프롬프트 ${items.length}개를 가져왔어요`);
      if (items.length === 1 && !/\.json$/i.test(f.name)) customEditSheet(items[0].id);
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ───────────────────────── 글꾸 공방 ─────────────────────────
const BOARD_KINDS = ['홍보', '공지', '업데이트', '자유'];
function viewBoard() {
  const B = S.board, inp = B.inputs;
  V().innerHTML = `<section class="page">
    ${secHead('04', 'BOARD', '글꾸 공방', '배포 게시판 규칙(순수 인라인·SMIL 애니메이션·불투명 배경·이미지 고정폭·우는 이모티콘 금지)을 지키는 게시글 꾸밈을 만들어요.')}
    <div class="card">
      <div class="field"><span>글 종류</span><div class="seg" data-seg="b-kind">${BOARD_KINDS.map(k => `<button type="button" class="${inp.kind === k ? 'on' : ''}" data-v="${k}">${k}</button>`).join('')}</div></div>
      <label class="field"><span>본문 내용 — 게시글에 들어갈 글 (내용은 그대로, 꾸밈만 입혀요)</span><textarea id="b-body" rows="7" placeholder="봇 소개, 특징, 플레이 팁, 업데이트 내역 등">${esc(inp.body || '')}</textarea></label>
      <label class="field"><span>컨셉 · 분위기 (선택)</span><textarea id="b-concept" rows="3" placeholder="예) 조선 무속 호러 — 한지, 먹, 붉은 실, 은은한 촛불">${esc(inp.concept || '')}</textarea></label>
      <div class="row wrap">
        <label class="field grow"><span>이미지 (한 줄에 하나: URL | 설명)</span><textarea id="b-images" rows="2" placeholder="https://… | 대표 이미지">${esc(inp.images || '')}</textarea></label>
        <label class="field inline"><span>기준 폭(px)</span><input id="b-width" type="number" min="280" max="1200" step="10" value="${esc(inp.width || 700)}"></label>
      </div>
      ${pickerHtml('board')}
      <div class="row between wrap"><button class="btn ghost" id="b-import">${ICON.upload} 기존 HTML 불러와 검사·변환</button><button class="btn primary" id="b-go" ${B.busy ? 'disabled' : ''}>${ICON.spark} ${B.busy ? '꾸미는 중…' : '글꾸 생성'}</button></div>
    </div>
    <div id="board-out">${B.busy ? progressHtml('게시글 꾸미는 중') : boardResultHtml()}</div>
  </section>`;
  const root = V();
  bindSeg(root, 'b-kind', v => B.inputs.kind = v);
  bindPicker(root, 'board');
  $('#b-go').onclick = () => runBoard();
  $('#b-import').onclick = boardImportSheet;
  bindBoardResult();
}
function captureBoard() {
  const i = S.board.inputs;
  i.body = $('#b-body')?.value ?? i.body; i.concept = $('#b-concept')?.value ?? i.concept;
  i.images = $('#b-images')?.value ?? i.images; i.width = Number($('#b-width')?.value) || i.width || 700;
}
async function runBoard(revise = null) {
  const B = S.board; captureBoard();
  if (!revise && !B.inputs.body?.trim()) return toast('본문 내용을 입력해 주세요', 'err');
  const task = revise ? G.reviseTask('게시판 글꾸', revise.json, revise.feedback, revise.issues) : G.boardTask(B.inputs);
  B.busy = true; viewBoard();
  try {
    const spec = G.extractJson(await runTask(task, 'board', progDelta, 'board'));
    if (!spec.html) throw new Error('응답에 html 이 없어요. 다시 시도해 주세요.');
    B.spec = spec; B.lastError = null;
  } catch (e) { toast(e.message, 'err'); B.lastError = e.message; }
  finally { B.busy = false; if (S.tab === 'board') viewBoard(); }
}
function boardResultHtml() {
  const B = S.board, sp = B.spec;
  if (!sp) return B.lastError ? `<div class="card error-card"><b>생성 실패</b><p>${esc(B.lastError)}</p></div>` : '';
  B.issues = L.lintBoard(sp.html);
  const w = B.inputs.width || 700;
  return `<div class="card result">
    <div class="result-head"><div class="sec-label"><span class="en">PREVIEW</span></div><h2>${esc(sp.title || '글꾸')}</h2></div>
    ${sp.notes ? `<div class="notes">${renderMd(sp.notes).html}</div>` : ''}
    <div class="frame-tools"><div class="seg small" data-seg="b-bg"><button type="button" class="${B.bg === 'light' ? 'on' : ''}" data-v="light">밝은 게시판</button><button type="button" class="${B.bg === 'dark' ? 'on' : ''}" data-v="dark">어두운 게시판</button></div><span class="grow"></span><span class="note mono">${w}px</span></div>
    <div class="frame-stage"><div class="frame-wrap" style="width:${w}px"><iframe id="b-frame" sandbox="" title="글꾸 미리보기"></iframe></div></div>
    <div class="lint-box" id="b-lint">${issuesHtml(B.issues, { compact: true })}</div>
    <label class="field"><span>HTML — 고치면 미리보기·검사에 바로 반영돼요</span><textarea id="b-html" class="code-area" rows="12" spellcheck="false">${esc(sp.html)}</textarea></label>
    <div class="row wrap">
      <button class="btn" id="b-inline">${ICON.wand} 인라인 변환</button>
      <button class="btn" id="b-save">${ICON.vault} 보관</button>
      <button class="btn" id="b-dl">${ICON.download} HTML 받기</button>
      <button class="btn primary" id="b-copy">${ICON.copy} 복사</button>
    </div>
    <div class="revise">
      <label class="field"><span>수정 요청</span><textarea id="b-fb" rows="3" placeholder="예) 제목을 더 크게 / 특징 목록을 카드형으로 / 전체 톤을 더 차분하게"></textarea></label>
      <div class="row end"><button class="btn" id="b-revise">${ICON.wand} 수정 요청 보내기</button></div>
    </div>
  </div>`;
}
function drawBoard() {
  const B = S.board, f = $('#b-frame'); if (!f || !B.spec) return;
  f.srcdoc = C.previewDoc(B.spec.html, { bg: B.bg });
}
function bindBoardResult() {
  const B = S.board; if (!B.spec || B.busy) return;
  const root = $('#board-out');
  bindSeg(root, 'b-bg', v => { B.bg = v; drawBoard(); });
  const ta = $('#b-html');
  const relint = () => { B.issues = L.lintBoard(B.spec.html); $('#b-lint').innerHTML = issuesHtml(B.issues, { compact: true }); };
  ta.addEventListener('input', debounce(() => { B.spec.html = ta.value; drawBoard(); relint(); }, 300));
  $('#b-inline').onclick = () => {
    const r = C.inlineCss(ta.value);
    if (!r.changed) return toast('변환할 <style> 이 없어요');
    ta.value = B.spec.html = r.html; drawBoard(); relint();
    toast('인라인 변환 완료' + (r.warnings.length ? ` — 주의 ${r.warnings.length}건` : ''));
    if (r.warnings.length) $('#b-lint').insertAdjacentHTML('afterbegin', `<ul class="conv-warn">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`);
  };
  $('#b-copy').onclick = () => copyText(ta.value);
  $('#b-dl').onclick = () => download(`${safeName(B.spec.title || curProject().name)}_글꾸.html`, ta.value, 'text/html');
  $('#b-save').onclick = async () => { const t = await askTitle(B.spec.title || '글꾸'); await saveArtifact({ kind: 'board', platform: defaultPlatform(), title: t, content: ta.value }); };
  $('#b-revise').onclick = () => runBoard({ json: JSON.stringify(B.spec, null, 2), feedback: $('#b-fb').value.trim(), issues: issuesText(B.issues || []) });
  drawBoard();
}
function boardImportSheet() {
  openSheet({
    title: '기존 글꾸 불러오기', wide: true,
    body: `<p class="note">붙여넣은 HTML을 글꾸 규칙으로 검사하고, &lt;style&gt;·class 가 있으면 인라인 변환할 수 있어요.</p>
      <label class="field"><span>HTML</span><textarea id="bi-html" class="code-area" rows="12" spellcheck="false"></textarea></label>
      <div class="row between"><button class="btn ghost small" id="bi-file">${ICON.upload} 파일에서 열기</button><button class="btn primary" id="bi-ok">${ICON.check} 불러오기</button></div>`,
    onMount: (b, close) => {
      $('#bi-file', b).onclick = async () => { const f = await readFile('.html,.htm,.txt'); if (f) $('#bi-html', b).value = f.text; };
      $('#bi-ok', b).onclick = () => { const h = $('#bi-html', b).value.trim(); if (!h) return; captureBoard(); S.board.spec = { title: '불러온 글꾸', html: h, notes: '' }; close(); viewBoard(); };
    }
  });
}

// ───────────────────────── 전역 액션 ─────────────────────────
const ACTS = {
  tab: (el) => setTab(el.dataset.tab),
  'chat-prompts': () => {
    const ta = $('#prompt'); if (ta && ta.value) S.pendingPrompt = ta.value;
    openSheet({
      title: '작업실 커스텀 프롬프트',
      body: `<p class="note">켜 둔 프롬프트가 이 프로젝트의 모든 대화에 함께 전달돼요. <b>우선</b> 표시는 기본 규칙과 충돌할 때 우선하는 프롬프트예요.</p>${pickerHtml('chat')}<div class="row end"><button class="btn ghost small" data-act="tab" data-tab="settings" data-close>${ICON.gear} 프롬프트 관리</button></div>`,
      onMount: (b) => bindPicker(b, 'chat'),
      onClose: () => { if (S.tab === 'chat') viewChat(); }
    });
  },
  'custom-new': (el) => customEditSheet(null, el.dataset.target),
  projects: () => projectSheet(),
  threads: () => threadSheet(),
  'new-thread': async () => {
    const t = { id: uid(), projectId: S.pid, title: '새 대화', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    await db.put('threads', t); S.threads.unshift(t); S.tid = t.id; saveUi(); viewChat();
  },
  suggest: (el) => { const s = SUGGEST[+el.dataset.i]; const ta = $('#prompt'); ta.value = s.p; ta.focus(); ta.setSelectionRange(s.p.length, s.p.length); ta.dispatchEvent(new Event('input')); },
  'msg-copy': (el) => copyText(curThread().messages[+el.dataset.mi].content),
  'msg-save': async (el) => { const m = curThread().messages[+el.dataset.mi]; const t = await askTitle(`메모 — ${curThread().title}`); await saveArtifact({ kind: 'other', platform: defaultPlatform(), title: t, content: m.content }); },
  'msg-del': async (el) => { const th = curThread(); th.messages.splice(+el.dataset.mi, 1); await db.put('threads', th); renderMsgs(); },
  'msg-edit': async (el) => {
    if (S.busy) return;
    const th = curThread(); const i = +el.dataset.mi; const m = th.messages[i];
    if (!(await confirmSheet('이 메시지부터 아래 대화를 지우고 내용을 입력창으로 가져올까요?', '가져오기', false))) return;
    th.messages.splice(i); await db.put('threads', th); S.pendingPrompt = m.content; viewChat();
  },
  'msg-regen': async () => {
    if (S.busy) return;
    const th = curThread();
    while (th.messages.length && th.messages[th.messages.length - 1].role === 'assistant') th.messages.pop();
    if (!th.messages.length) return;
    sendChat(th.messages[th.messages.length - 1].content, { replaceLast: true });
  },
  code: async (el) => {
    const c = S.codes[+el.dataset.mi]?.[+el.dataset.ci]; if (!c) return;
    const op = el.dataset.op;
    if (op === 'copy') return copyText(c.code);
    if (op === 'preview') return htmlPreviewSheet(c.code);
    if (op === 'preview-regex') { try { return regexPreviewSheet(JSON.parse(c.code), '', defaultPlatform()); } catch (e) { return toast(e.message, 'err'); } }
    if (op === 'lint') { S.lint.text = c.code; S.lint.mode = 'auto'; S.lint.platform = defaultPlatform(); setTab('lint'); runLint(); return; }
    if (op === 'dl') { const json = c.lang === 'json' || /^\s*[\[{]/.test(c.code); return download(`${safeName(curProject().name)}_${Date.now().toString(36)}.${json ? 'json' : c.lang === 'html' ? 'html' : 'txt'}`, c.code, json ? 'application/json' : 'text/plain'); }
    if (op === 'save') { const d = L.detect(c.code); const t = await askTitle(`${KIND_LABEL[kindFromLint(d.kind)]} — ${curThread().title}`); return saveArtifact({ kind: kindFromLint(d.kind), platform: /^st/.test(d.kind) ? 'st' : defaultPlatform(), title: t, content: c.code }); }
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div class="fatal">시작 오류: ${esc(e.message)}</div>`); });
