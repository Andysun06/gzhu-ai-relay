// 广大课表 AI 中转 · Cloudflare Pages Function
// 路由：/api/ai/chat/completions（App 端把 Base URL 配为 https://<本项目域名>/api/ai）
//
// 凭据：只读环境变量 ZHIPU_API_KEY（Pages → Settings → Environment variables 配置 secret）。
//       本仓库任何文件都不包含可用 key。
//
// 安全设计：
//   1. 上游为代码字面量常量：仅 https、仅 open.bigmodel.cn（不随任何输入变化，杜绝 SSRF）。
//   2. 模型白名单：默认仅免费 glm-4.7-flash；名单外一律替换为默认模型，杜绝刷付费模型欠费。
//   3. max_tokens 上限 4096：即使免费模型也防止超大输出消耗额度。
//   4. Origin 白名单 CORS（不用 *）；IP 滑窗限流（request.ip 由 Cloudflare 边缘提供）；
//      请求体 ≤1MB；不跟随重定向；不记录请求内容，日志仅状态码。
//   5. 关闭思考：App 端会在请求里带 thinking:{type:"disabled"}（本函数原样转发给智谱）。

const UPSTREAM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'; // 固定字面量：https + 公开主机
const RATE_LIMIT = 20;          // 每 IP 每分钟
const RATE_WINDOW_MS = 60_000;
const MAX_BODY = 1024 * 1024;   // 1MB
const MAX_TOKENS_CAP = 4096;

function allowedModels(env) {
  const raw = String((env && env.ALLOWED_MODELS) || 'glm-4.7-flash');
  const set = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  return set.size ? set : new Set(['glm-4.7-flash']);
}

function allowedOrigins(env) {
  const base = 'capacitor://localhost,http://localhost,https://localhost';
  const raw = String((env && env.ALLOWED_ORIGINS) || base);
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = String(request.headers.get('origin') || '');
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
  };
  if (origin && (allowedOrigins(env).has(origin) || origin.endsWith('.pages.dev'))) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
}

// 实例内存级限流（Workers 每 isolate 独立计数；对免费额度防滥用足够）
const rateBuckets = new Map();
function isRateLimited(clientIp) {
  const ip = String(clientIp || 'unknown');
  const now = Date.now();
  let arr = rateBuckets.get(ip);
  if (!arr) { arr = []; rateBuckets.set(ip, arr); }
  while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
  if (arr.length >= RATE_LIMIT) return true;
  arr.push(now);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (!v.length) rateBuckets.delete(k);
  }
  return false;
}

function jsonRes(status, obj, h) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...h } });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const h = corsHeaders(request, env);

  const apiKey = env && env.ZHIPU_API_KEY;
  if (!apiKey) return jsonRes(500, { error: { message: 'Relay not configured: ZHIPU_API_KEY missing' } }, h);
  if (isRateLimited(request.ip)) return jsonRes(429, { error: { message: '请求过于频繁，请稍后再试' } }, h);

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return jsonRes(413, { error: { message: 'Request body too large' } }, h);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonRes(400, { error: { message: 'Invalid JSON body' } }, h);
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) {
    return jsonRes(400, { error: { message: 'messages required' } }, h);
  }
  // 模型白名单：名单外一律替换为默认免费模型（不报错，体验平滑）
  const models = allowedModels(env);
  if (!models.has(payload.model)) payload.model = models.values().next().value;
  // 输出上限：防超大 tokens 消耗额度
  if (typeof payload.max_tokens !== 'number' || payload.max_tokens > MAX_TOKENS_CAP) payload.max_tokens = MAX_TOKENS_CAP;

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      // Workers 不支持 redirect:'error'；manual + 手动拒绝 3xx，杜绝重定向把请求引去其它主机
      redirect: 'manual',
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      console.log('[ai-relay] upstream_redirect_rejected');
      return jsonRes(502, { error: { message: 'Upstream request failed' } }, h);
    }
    const text = await upstream.text();
    console.log(`[ai-relay] status=${upstream.status}`);
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json', ...h },
    });
  } catch (err) {
    console.log(`[ai-relay] upstream_error=${err && err.name}`);
    return jsonRes(502, { error: { message: 'Upstream request failed' } }, h);
  }
}
