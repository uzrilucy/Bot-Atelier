// 생성기 프롬프트 + 응답 JSON 추출

export function extractJson(text) {
  const cands = [...String(text).matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/g)].map(m => m[1]);
  const i = String(text).search(/[\[{]/);
  if (i >= 0) cands.push(sliceBalanced(text, i));
  for (const c of cands) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
    try { return JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  throw new Error('응답에서 올바른 JSON을 찾지 못했어요.');
}
function sliceBalanced(s, start) {
  const open = s[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < s.length; k++) {
    const ch = s[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return s.slice(start, k + 1);
  }
  return s.slice(start);
}

const JSON_ONLY = '응답은 반드시 ```json 코드 블록 하나만 출력하세요. 코드 블록 밖에 다른 글을 쓰지 마세요. JSON 문자열 안의 따옴표·역슬래시·줄바꿈은 정확히 이스케이프하세요.';

export function lorebookTask({ platform, brief, count, index, existing }) {
  return {
    extra: `# 지금 할 일: 로어북 엔트리 생성
${JSON_ONLY}
스키마:
{"entries":[{"comment":"표시 이름(한국어 가능)","keys":["키워드", "English keyword"],"secondaryKeys":[],"content":"English lorebook text","constant":false,"order":100}],"notes":"한국어 2~4줄 설명 — 설계 의도와 주의점"}
규칙:
- content 는 영어로 압축하되 핵심 설정·감각 묘사·제약(Absolute Constraint)은 살릴 것.
- keys 에는 한국어와 영어/로마자 표기를 함께. 너무 흔한 단어(“나”, “the”)는 피할 것.
- 엔트리 수: ${count ? `약 ${count}개` : '설정에 필요한 만큼'}.
${index ? '- 마지막에 constant:true, order:1 인 인덱스 엔트리를 하나 추가: comment는 "(Index) 요약", content는 다른 모든 엔트리의 이름과 핵심 키워드를 한 줄씩 정리.' : ''}
- 대상 플랫폼: ${platform === 'st' ? '실리태번' : platform === 'risu' ? '리스AI' : '둘 다'} (앱이 플랫폼 형식으로 변환하므로 위 스키마 그대로 출력).`,
    user: `${brief}${existing ? `\n\n[기존 엔트리 참고 — 중복 없이 보완]\n${existing}` : ''}`
  };
}

export function regexTask({ platform, brief }) {
  const risu = platform !== 'st';
  return {
    extra: `# 지금 할 일: 정규식 생성 (${risu ? '리스AI' : '실리태번'})
${JSON_ONLY}
스키마:
{"rules":[{"comment":"이름","kind":"display|output|input|request","in":"JS 정규식 소스(슬래시 없이)","out":"치환 결과","flag":"g"}],"sample":"정규식이 실제로 걸리는 예시 AI 출력 텍스트","notes":"한국어 설명"}
- kind: display=화면 표시만 변경, output=AI 출력 자체 수정, input=사용자 입력 수정, request=AI에 보낼 때만 수정.
${risu ? '- 표시용(display) out 은 인라인 style 만, 한 줄로. CBS를 쓰면 flag 를 "gu<cbs>".' : '- 표시용 out 은 <style> 사용 가능, 클래스명은 고유 접두사로 네임스페이스.'}
- 캡처 그룹은 $1, $2 … 로 참조.`,
    user: brief
  };
}

export function triggerTask({ brief }) {
  return {
    extra: `# 지금 할 일: 리스AI 트리거 생성
${JSON_ONLY}
스키마:
{"triggers":[{"comment":"TriggerName","type":"manual|output|input|start","conditions":[],"effect":[{"type":"v2SetVar","operator":"=","var":"변수명","value":"값","valueType":"value","indent":0},{"type":"v2Impersonate","role":"user","value":"[행동 텍스트]","valueType":"value","indent":0}],"lowLevelAccess":false}],"buttons":"이 트리거들을 호출하는 {{button::라벨::TriggerName}} 예시(한 줄)","notes":"한국어 설명 — 변수 흐름과 사용법"}
- 버튼에서 부르는 트리거는 type "manual", 출력 후 상태 정리는 "output".
- comment 는 영문 PascalCase 로 고유하게.`,
    user: brief
  };
}

export function uiTask({ platform, brief, tag, fields, mood }) {
  const risu = platform !== 'st';
  return {
    extra: `# 지금 할 일: 상태창 UI 설계·제작 (${risu ? '리스AI' : '실리태번'})
${JSON_ONLY}
스키마:
{"name":"디자인 이름","concept":"디자인 언어 설명(한국어 2~3줄)","tag":"${tag || 'ABST'}","promptFormat":"봇 프롬프트에 넣을 상태창 출력 지시문(영어, 대문자 헤더는 번역 금지 명시, 태그 포함 출력 형식 예시)","sample":"상태창 블록이 들어간 예시 AI 출력(서술 1~2문단 + 블록)","rules":[{"comment":"이름 ① 메인","in":"JS 정규식 소스","out":"HTML","flag":"g"}],"vars":{"CBS변수명":"미리보기 값"},"notes":"한국어 — 적용 방법과 주의점"}
디자인:
- 세계관·분위기에서 출발한 고유 디자인 언어. 뻔한 카드 UI 반복 금지. 타이포·여백·질감·깊이·섹션별 개성, 그리고 가독성.
- 코드 길이·토큰은 신경 쓰지 말고 퀄리티와 디테일에 집중.
${risu ? `- 리스 규칙: out 은 인라인 style 만(<style>·class 금지), 애니메이션은 SVG SMIL 만, out 은 한 줄로 압축.
- 칩 목록이 필요하면 필드 값 안에서만 "||" 로 구분하고, ② 칩 분리 정규식(in: "\\\\s*\\\\|\\\\|\\\\s*")을 메인 다음 순서로 둘 것.
- 변수 기반 수치를 쓰면 flag 를 "gu<cbs>" 로 하고 vars 에 미리보기 값을 넣을 것.` : `- 실리 규칙: <style> 사용 가능하되 모든 클래스에 고유 접두사. CSS 애니메이션 가능.`}
- sample 에는 정규식이 실제로 매치되는 완전한 블록이 있어야 함(미리보기에 사용).`,
    user: `컨셉: ${brief}${fields ? `\n필드: ${fields}` : ''}${mood ? `\n분위기 키워드: ${mood}` : ''}`
  };
}

export function reviseTask(kindLabel, currentJson, feedback, issues) {
  return {
    extra: `# 지금 할 일: ${kindLabel} 수정
${JSON_ONLY}
현재 결과물(JSON)을 아래 요청과 검사 결과에 맞게 고쳐서 같은 스키마의 전체 JSON으로 다시 출력하세요. 요청과 무관한 부분의 핵심 매력은 보존하세요.`,
    user: `[현재 결과물]\n\`\`\`json\n${currentJson}\n\`\`\`\n\n[수정 요청]\n${feedback || '(검사 결과의 문제만 고쳐 주세요)'}${issues ? `\n\n[검사기 지적 사항]\n${issues}` : ''}`
  };
}
