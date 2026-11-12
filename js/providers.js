// AI 연결부 — Vertex(우선) / Gemini AI Studio / OpenAI / Claude / OpenAI 호환
// 모든 호출은 브라우저에서 직접. 키는 이 기기의 IndexedDB에만 저장됨.

export const PROVIDERS = {
  vertex: { label: 'Vertex AI', hint: 'Google Cloud Vertex — 익스프레스 API 키 / 서비스 계정 JSON / 액세스 토큰' },
  gemini: { label: 'Gemini (AI Studio)', hint: 'aistudio.google.com 에서 발급한 API 키' },
  openai: { label: 'OpenAI', hint: 'platform.openai.com API 키' },
  anthropic: { label: 'Claude (Anthropic)', hint: 'console.anthropic.com API 키' },
  compat: { label: 'OpenAI 호환', hint: 'OpenRouter·프록시·로컬 서버 등 /chat/completions 호환 주소' }
};

export const MODEL_SUGGEST = {
  vertex_google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  vertex_anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  openai: ['gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  compat: []
};

export function defaultProviderConfig() {
  return {
    active: 'vertex',
    temperature: 0.9,
    maxTokens: 16384,
    history: 30,
    vertex: { auth: 'express', apiKey: '', saJson: '', token: '', project: '', location: 'global', publisher: 'google', model: 'gemini-2.5-pro' },
    gemini: { apiKey: '', model: 'gemini-2.5-pro' },
    openai: { apiKey: '', model: 'gpt-4.1' },
    anthropic: { apiKey: '', model: 'claude-sonnet-4-5' },
    compat: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: '' }
  };
}

const HARM = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'];

// ---------- 유틸 ----------
const enc = new TextEncoder();
function b64urlBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64url = (str) => b64urlBytes(enc.encode(str));
function pemToDer(pem) {
  const b = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

// 연속된 같은 역할 메시지 병합 + 첫 메시지는 user 로 (Claude 요구사항, 다른 곳에도 무해)
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    if (!m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + m.content;
    else out.push({ role, content: m.content });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '(이어서)' });
  return out;
}

// ---------- Vertex 서비스 계정 → 액세스 토큰 (브라우저 내 JWT 서명) ----------
let saCache = { key: '', token: '', exp: 0 };
export async function vertexSaToken(saJson) {
  let sa;
  try { sa = JSON.parse(saJson); } catch { throw new Error('서비스 계정 JSON 형식이 올바르지 않아요.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('서비스 계정 JSON에 client_email / private_key 가 없어요.');
  if (!crypto?.subtle) throw new Error('이 환경은 보안 컨텍스트(https 또는 localhost)가 아니라 서명할 수 없어요.');
  const now = Math.floor(Date.now() / 1000);
  if (saCache.key === sa.client_email && saCache.exp - 120 > now) return { token: saCache.token, project: sa.project_id };
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: tokenUri, iat: now, exp: now + 3600 }));
  const data = `${head}.${claim}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data)));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${data}.${b64urlBytes(sig)}` })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('토큰 발급 실패: ' + (j.error_description || j.error || res.status));
  saCache = { key: sa.client_email, token: j.access_token, exp: now + (j.expires_in || 3600) };
  return { token: j.access_token, project: sa.project_id };
}

// ---------- 요청 빌더 ----------
function geminiBody(system, messages, cfg) {
  const body = {
    contents: normalize(messages).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: Number(cfg.temperature), maxOutputTokens: Number(cfg.maxTokens) },
    safetySettings: HARM.map(category => ({ category, threshold: 'BLOCK_NONE' }))
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return body;
}
function anthropicBody(system, messages, cfg, vertex = false) {
  const body = {
    messages: normalize(messages),
    max_tokens: Number(cfg.maxTokens),
    temperature: Math.min(1, Number(cfg.temperature)),
    stream: true
  };
  if (system) body.system = system;
  if (vertex) body.anthropic_version = 'vertex-2023-10-16';
  return body;
}
function openaiBody(system, messages, cfg, model) {
  const msgs = normalize(messages);
  if (system) msgs.unshift({ role: 'system', content: system });
  return { model, messages: msgs, temperature: Number(cfg.temperature), max_tokens: Number(cfg.maxTokens), stream: true };
}

async function vertexAuth(v) {
  if (v.auth === 'sa') {
    const { token, project } = await vertexSaToken(v.saJson);
    return { headers: { Authorization: `Bearer ${token}` }, project: v.project || project };
  }
  if (v.auth === 'token') {
    if (!v.token) throw new Error('Vertex 액세스 토큰을 입력해 주세요.');
    return { headers: { Authorization: `Bearer ${v.token.trim()}` }, project: v.project };
  }
  return { headers: {}, project: v.project };
}
const vertexHost = (loc) => (!loc || loc === 'global') ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;

async function buildRequest(system, messages, cfg) {
  const p = cfg.active;
  if (p === 'vertex') {
    const v = cfg.vertex;
    const loc = v.location || 'global';
    if (v.publisher === 'anthropic') {
      if (v.auth === 'express') throw new Error('Vertex의 Claude 모델은 익스프레스 키로 호출할 수 없어요. 서비스 계정 JSON 또는 액세스 토큰을 써 주세요.');
      const a = await vertexAuth(v);
      if (!a.project) throw new Error('Vertex 프로젝트 ID가 필요해요.');
      return {
        kind: 'anthropic',
        url: `https://${vertexHost(loc)}/v1/projects/${a.project}/locations/${loc}/publishers/anthropic/models/${v.model}:streamRawPredict`,
        headers: { 'Content-Type': 'application/json', ...a.headers },
        body: anthropicBody(system, messages, cfg, true)
      };
    }
    if (v.auth === 'express') {
      if (!v.apiKey) throw new Error('Vertex 익스프레스 API 키를 입력해 주세요.');
      return {
        kind: 'gemini',
        url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${v.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(v.apiKey.trim())}`,
        headers: { 'Content-Type': 'application/json' },
        body: geminiBody(system, messages, cfg)
      };
    }
    const a = await vertexAuth(v);
    if (!a.project) throw new Error('Vertex 프로젝트 ID가 필요해요.');
    return {
      kind: 'gemini',
      url: `https://${vertexHost(loc)}/v1/projects/${a.project}/locations/${loc}/publishers/google/models/${v.model}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', ...a.headers },
      body: geminiBody(system, messages, cfg)
    };
  }
  if (p === 'gemini') {
    const g = cfg.gemini;
    if (!g.apiKey) throw new Error('Gemini API 키를 입력해 주세요.');
    return {
      kind: 'gemini',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${g.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(g.apiKey.trim())}`,
      headers: { 'Content-Type': 'application/json' },
      body: geminiBody(system, messages, cfg)
    };
  }
  if (p === 'anthropic') {
    const a = cfg.anthropic;
    if (!a.apiKey) throw new Error('Claude API 키를 입력해 주세요.');
    return {
      kind: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'Content-Type': 'application/json', 'x-api-key': a.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: a.model, ...anthropicBody(system, messages, cfg) }
    };
  }
  // openai / compat
  const o = cfg[p];
  const base = p === 'openai' ? 'https://api.openai.com/v1' : (o.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('호환 API 주소를 입력해 주세요.');
  const headers = { 'Content-Type': 'application/json' };
  if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey.trim()}`;
  if (p === 'compat' && /openrouter\.ai/.test(base)) { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Bot Atelier'; }
  if (!o.model) throw new Error('모델 이름을 입력해 주세요.');
  return { kind: 'openai', url: `${base}/chat/completions`, headers, body: openaiBody(system, messages, cfg, o.model) };
}

// ---------- 응답 파서 ----------
function deltaOf(kind, j) {
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  if (kind === 'gemini') {
    if (j.promptFeedback?.blockReason) throw new Error('요청이 차단됐어요: ' + j.promptFeedback.blockReason);
    const c = j.candidates?.[0];
    if (!c) return '';
    if (c.finishReason && /SAFETY|PROHIBITED|BLOCKLIST/.test(c.finishReason) && !c.content) throw new Error('안전 필터로 응답이 중단됐어요 (' + c.finishReason + ')');
    return (c.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  }
  if (kind === 'anthropic') {
    if (j.type === 'error') throw new Error(j.error?.message || 'Claude 오류');
    if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') return j.delta.text;
    return '';
  }
  return j.choices?.[0]?.delta?.content || '';
}
function wholeOf(kind, j) {
  if (Array.isArray(j)) return j.map(x => wholeOf(kind, x)).join('');
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  if (kind === 'gemini') return (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  if (kind === 'anthropic') return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return j.choices?.[0]?.message?.content || '';
}

async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
  buf += dec.decode();
  if (buf.startsWith('data:')) onData(buf.slice(5).trim());
}

function explain(status, text) {
  let msg = text;
  try { const j = JSON.parse(text); msg = j.error?.message || j.message || j.error_description || text; } catch {}
  const hint = status === 401 || status === 403 ? ' — 키/권한(IAM: Vertex AI User)을 확인해 주세요.'
    : status === 404 ? ' — 모델 이름이나 리전(location)을 확인해 주세요.'
    : status === 429 ? ' — 요청 한도 초과. 잠시 후 다시 시도해 주세요.' : '';
  return `[${status}] ${String(msg).slice(0, 400)}${hint}`;
}

// ---------- 공개 API ----------
export async function chat({ system, messages, cfg, onDelta, signal }) {
  const req = await buildRequest(system, messages, cfg);
  let res;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('네트워크 오류: ' + e.message + ' (CORS 차단이거나 주소가 틀렸을 수 있어요)');
  }
  if (!res.ok) throw new Error(explain(res.status, await res.text()));
  let full = '';
  const push = (t) => { if (t) { full += t; onDelta && onDelta(t, full); } };
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) {
    push(wholeOf(req.kind, await res.json()));
    return full;
  }
  await readSSE(res, (data) => {
    if (!data || data === '[DONE]') return;
    let j; try { j = JSON.parse(data); } catch { return; }
    push(deltaOf(req.kind, j));
  });
  return full;
}

export async function listModels(cfg) {
  const p = cfg.active;
  if (p === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(cfg.gemini.apiKey.trim())}`);
    if (!r.ok) throw new Error(explain(r.status, await r.text()));
    const j = await r.json();
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  }
  if (p === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': cfg.anthropic.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!r.ok) throw new Error(explain(r.status, await r.text()));
    return ((await r.json()).data || []).map(m => m.id);
  }
  if (p === 'openai' || p === 'compat') {
    const o = cfg[p];
    const base = p === 'openai' ? 'https://api.openai.com/v1' : o.baseUrl.replace(/\/+$/, '');
    const r = await fetch(`${base}/models`, { headers: o.apiKey ? { Authorization: `Bearer ${o.apiKey.trim()}` } : {} });
    if (!r.ok) throw new Error(explain(r.status, await r.text()));
    return ((await r.json()).data || []).map(m => m.id).sort();
  }
  return MODEL_SUGGEST[cfg.vertex.publisher === 'anthropic' ? 'vertex_anthropic' : 'vertex_google'];
}

export function activeModelLabel(cfg) {
  const p = cfg.active;
  const m = cfg[p]?.model || '';
  return `${PROVIDERS[p]?.label || p}${m ? ' · ' + m : ''}`;
}
