import Anthropic from '@anthropic-ai/sdk';
import { isSmallModel, isTask, joinParts, MAX_USER_PROMPT, promptParts, SMALL_MODEL_CHECK, SMALL_MODEL_EFFORT, SMALL_MODEL_NO_THINKING, TASKS, type AiTask } from '../src/ai/prompts';

// 유료 API 프록시의 본체. Firebase Cloud Function(배포)과 Vite 개발 서버(로컬)가 같은 코드를 쓴다.
// API 키는 이 서버 안에서만 읽고 브라우저로 보내지 않는다.
// 공급자를 차례로 시도한다: Claude(ANTHROPIC_API_KEY) → OpenAI(OPENAI_API_KEY) → Vertex AI Gemini(Cloud Function 안에서만, 서비스 계정 인증) → Gemini 개발자 API(GEMINI_API_KEY). 설정된 것만 쓴다.
// 배포 모델은 functions/.env(예시: functions/.env.example)로 정한다. 아래 코드 기본값은 설정이 없을 때만 쓰인다.
// 한 공급자가 늦거나 실패하면 다음 공급자로 넘어가, 한 서비스의 장애가 대화 전체를 멈추지 않게 한다.

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  /** 설정이 없으면 claude-sonnet-5-5. 배포는 claude-haiku-5-5 (비교: design/model-eval-2026-10-13, design/model-eval-2026-10-17-talk) */
  ANTHROPIC_MODEL?: string;
  /** 작업별로 다른 Claude 모델을 쓸 때 ("hint=claude-sonnet-5-5,grade=claude-sonnet-5-5"). 적지 않은 작업은 ANTHROPIC_MODEL */
  ANTHROPIC_TASK_MODELS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Google Cloud 프로젝트 ID. 있으면 Vertex AI(서비스 계정 인증, 키 없음)를 쓴다. Cloud Function 안에서만 채운다 */
  VERTEX_PROJECT?: string;
  VERTEX_MODEL?: string;
  OPENAI_API_KEY?: string;
  /** 기본 gpt-6-luna (2026-10-17 비교용으로 추가) */
  OPENAI_MODEL?: string;
}

/** 토큰 사용량 (Claude만). 비용 확인용 */
export interface AiUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface AiResult { text: string; provider: string; model: string; ms: number; usage?: AiUsage }

export class AiHttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

/** 공급자 한 번의 시도 시간 상한. 넘기면 다음 공급자로 넘어간다 */
const CLAUDE_TIMEOUT_MS = 25000;
const GEMINI_TIMEOUT_MS = 25000;
const VERTEX_TIMEOUT_MS = 25000;
const OPENAI_TIMEOUT_MS = 25000;

/** "hint=claude-sonnet-5-5,grade=..." 에서 이 작업의 모델 */
export function taskModel(spec: string | undefined, task: AiTask): string | undefined {
  const entries = spec?.split(',').map((x) => x.trim().split('='));
  return entries?.find(([k]) => k === task)?.[1]?.trim() || undefined;
}

let claude: { key: string; client: Anthropic } | null = null;
function claudeClient(key: string): Anthropic {
  if (claude?.key !== key) claude = { key, client: new Anthropic({ apiKey: key, maxRetries: 1, timeout: CLAUDE_TIMEOUT_MS }) };
  return claude.client;
}

async function viaClaude(task: AiTask, user: string, env: AiEnv, signal?: AbortSignal): Promise<{ text: string; model: string; usage: AiUsage }> {
  const t = TASKS[task];
  const model = taskModel(env.ANTHROPIC_TASK_MODELS, task) || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  // 프롬프트 칸마다 캐시 표시를 붙인다 (마지막 칸은 매번 바뀌므로 붙이지 않는다). 지시문까지 합쳐 표시는 많아야 4개다.
  // 지시문은 1시간 캐시다 (거의 바뀌지 않고 모든 인물·플레이어가 같이 쓴다). 칸별 캐시 시간은 작업 설정(TASKS의 cache)을 따르고,
  // 적지 않은 칸은 5분이다. 자주 바뀌는 칸은 저장 요금이 두 배인 1시간보다 5분이 싸다 (scripts/cache-churn.ts). 긴 캐시가 짧은 캐시보다 앞에 와야 한다.
  const parts = promptParts(user);
  const content = parts.map((text, i) => ({ type: 'text' as const, text, ...(i < parts.length - 1 ? { cache_control: t.cache?.[i] === '1h' ? { type: 'ephemeral' as const, ttl: '1h' as const } : { type: 'ephemeral' as const } } : {}) }));
  // 작은 모델은 긴 지시문의 규칙을 답 직전에 한 번 더 짚어 준다 (캐시하지 않는 마지막 칸 뒤에 붙인다)
  const small = isSmallModel(model);
  const check = small ? SMALL_MODEL_CHECK[task] : undefined;
  if (check) content.push({ type: 'text', text: check });
  const res = await claudeClient(env.ANTHROPIC_API_KEY!).messages.create(
    {
      model,
      max_tokens: t.maxTokens,
      // 지시문은 작업마다 고정이라 캐시해 둔다 (같은 작업의 다음 요청이 빨라지고 싸진다)
      system: [{ type: 'text', text: t.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content }],
      // 진술서처럼 생각 없이도 같은 결과가 나오는 작업은 생각을 꺼서 빠르게 한다 (Haiku 5.5는 생각 길이 상한을 받지 않는다. effort나 끄기만 된다)
      ...(small && SMALL_MODEL_NO_THINKING.has(task) ? { thinking: { type: 'disabled' as const } } : {}),
      // 분류·짧은 대사 작업이다. 생각은 짧게 하고 정해진 JSON으로만 답하게 한다
      output_config: { effort: (small ? SMALL_MODEL_EFFORT[task] ?? t.effort : t.effort) ?? 'low', format: { type: 'json_schema', schema: t.schema } },
    },
    // 진술서처럼 길게 쓰는 작업은 시간 상한을 따로 둔다
    { signal, ...(t.timeoutMs ? { timeout: t.timeoutMs } : {}) },
  );
  if (res.stop_reason === 'refusal') throw new AiHttpError(502, 'refusal');
  if (res.stop_reason === 'max_tokens') throw new AiHttpError(502, 'truncated');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  if (!text) throw new AiHttpError(502, 'empty');
  const u = res.usage;
  return { text, model, usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } };
}

async function viaGemini(task: AiTask, user: string, env: AiEnv, signal?: AbortSignal): Promise<{ text: string; model: string; usage?: AiUsage }> {
  const t = TASKS[task];
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const timeout = AbortSignal.timeout(t.timeoutMs ?? GEMINI_TIMEOUT_MS);
  // Gemma는 지시문 칸과 JSON 스키마를 받지 않는다: 지시문을 앞에 붙이고 JSON만 요구한다
  const gemma = model.startsWith('gemma');
  // Gemini 3 이후는 생각 수준을 낮춰 응답을 빠르게 한다 (2.5는 기본값)
  const thinking = /^gemini-([3-9]|\d\d)/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {};
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: t.system }] } }),
      contents: [{ role: 'user', parts: [{ text: gemma ? `${t.system}

${joinParts(user)}

아래 JSON 스키마에 맞는 JSON 하나만 출력한다:
${JSON.stringify(t.schema)}` : joinParts(user) }] }],
      generationConfig: gemma ? { temperature: t.temperature } : { responseMimeType: 'application/json', responseJsonSchema: t.schema, temperature: t.temperature, ...thinking },
    }),
  });
  type Out = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string }; usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
  const json = await r.json().catch(() => null) as Out | null;
  if (!r.ok) throw new AiHttpError(r.status, 'upstream', json?.error?.message);
  let text = json?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  if (gemma) text = text.replace(/^[\s\S]*?```(?:json)?\s*/, '').replace(/```[\s\S]*$/, '').trim() || text;
  if (!text) throw new AiHttpError(502, 'empty');
  const u = json?.usageMetadata;
  const cached = u?.cachedContentTokenCount ?? 0;
  return { text, model, ...(u ? { usage: { input: (u.promptTokenCount ?? 0) - cached, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: cached, cacheWrite: 0 } } : {}) };
}

/** OpenAI Responses API. 프롬프트 캐시는 앞부분이 같으면 자동으로 적용된다 (지시문 → 프롬프트 칸 순서 그대로 보낸다) */
async function viaOpenAI(task: AiTask, user: string, env: AiEnv, signal?: AbortSignal): Promise<{ text: string; model: string; usage: AiUsage }> {
  const t = TASKS[task];
  const model = env.OPENAI_MODEL || 'gpt-6-luna';
  const small = isSmallModel(model);
  const check = small ? SMALL_MODEL_CHECK[task] : undefined;
  const timeout = AbortSignal.timeout(t.timeoutMs ?? OPENAI_TIMEOUT_MS);
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      model,
      instructions: t.system,
      input: joinParts(user) + (check ? `

${check}` : ''),
      max_output_tokens: t.maxTokens,
      reasoning: { effort: (small ? SMALL_MODEL_EFFORT[task] ?? t.effort : t.effort) ?? 'low' },
      text: { format: { type: 'json_schema', name: task, strict: true, schema: t.schema } },
      prompt_cache_key: task,
    }),
  });
  type Out = { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } }; error?: { message?: string }; incomplete_details?: { reason?: string } };
  const json = await r.json().catch(() => null) as Out | null;
  if (!r.ok) throw new AiHttpError(r.status, 'upstream', json?.error?.message);
  if (json?.status === 'incomplete') throw new AiHttpError(502, 'truncated', json.incomplete_details?.reason);
  const text = json?.output?.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('') ?? '';
  if (!text) throw new AiHttpError(502, 'empty');
  const u = json?.usage;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  return { text, model, usage: { input: (u?.input_tokens ?? 0) - cached, output: u?.output_tokens ?? 0, cacheRead: cached, cacheWrite: 0 } };
}

/** Cloud Function의 서비스 계정 토큰 (메타데이터 서버). 만료 1분 전까지 다시 쓴다 */
let vertexToken: { token: string; until: number } | null = null;
async function metadataToken(): Promise<string> {
  if (vertexToken && Date.now() < vertexToken.until) return vertexToken.token;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new AiHttpError(502, 'vertex-auth');
  const j = await r.json() as { access_token: string; expires_in: number };
  vertexToken = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return j.access_token;
}

/** Vertex AI의 Gemini. 브라우저의 Firebase AI Logic과 같은 모델이지만 서버에서 바로 불러 더 빠르다 */
async function viaVertex(task: AiTask, user: string, env: AiEnv, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  const t = TASKS[task];
  const model = env.VERTEX_MODEL || 'gemini-2.5-flash-lite';
  const timeout = AbortSignal.timeout(VERTEX_TIMEOUT_MS);
  const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${env.VERTEX_PROJECT}/locations/global/publishers/google/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await metadataToken()}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: t.system }] },
      contents: [{ role: 'user', parts: [{ text: joinParts(user) }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: t.schema, temperature: t.temperature },
    }),
  });
  const json = await r.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
  if (!r.ok) throw new AiHttpError(r.status, 'upstream', json?.error?.message);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new AiHttpError(502, 'empty');
  return { text, model };
}

/** JSON으로 읽히는 답인가 (깨진 답은 실패로 보고 다음 공급자를 시도한다) */
function parses(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

export function providers(env: AiEnv): string[] {
  // Claude가 실패하면(크레딧 소진·장애) OpenAI → Vertex → Gemini 순서로 넘어간다. 키(설정)가 있는 공급자만 넣는다
  return [env.ANTHROPIC_API_KEY ? 'claude' : '', env.OPENAI_API_KEY ? 'openai' : '', env.VERTEX_PROJECT ? 'vertex' : '', env.GEMINI_API_KEY ? 'gemini' : ''].filter(Boolean);
}

/**
 * 요청 본문({task, user})을 받아 AI 답(JSON 문자열)을 돌려준다.
 * 지시문은 서버가 작업 이름으로 고른다. 사용자 프롬프트 길이를 제한한다.
 */
export async function runAi(body: unknown, env: AiEnv, signal?: AbortSignal): Promise<AiResult> {
  const b = (body ?? {}) as { task?: unknown; user?: unknown };
  if (!isTask(b.task)) throw new AiHttpError(400, 'task');
  if (typeof b.user !== 'string' || !b.user.trim() || b.user.length > MAX_USER_PROMPT) throw new AiHttpError(400, 'user');
  const list = providers(env);
  if (!list.length) throw new AiHttpError(503, 'no-provider');
  const started = Date.now();
  let last: unknown = null;
  for (const p of list) {
    try {
      const out: { text: string; model: string; usage?: AiUsage } = p === 'claude' ? await viaClaude(b.task, b.user, env, signal) : p === 'openai' ? await viaOpenAI(b.task, b.user, env, signal) : p === 'vertex' ? await viaVertex(b.task, b.user, env, signal) : await viaGemini(b.task, b.user, env, signal);
      if (!parses(out.text)) throw new AiHttpError(502, 'bad-json');
      return { text: out.text, provider: p, model: out.model, ms: Date.now() - started, ...(out.usage ? { usage: out.usage } : {}) };
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      console.warn(`[ai] ${p} 실패:`, e instanceof Error ? e.message : e);
    }
  }
  if (last instanceof AiHttpError) throw new AiHttpError(last.status >= 500 || last.status === 429 ? last.status : 502, last.code, last.message);
  throw new AiHttpError(502, 'upstream', last instanceof Error ? last.message : String(last));
}
