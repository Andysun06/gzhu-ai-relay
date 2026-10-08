// 健康检查：App 端用它判断「中转站是否可达」，可达才允许使用 AI 功能。
// 返回 { ok, configured, ts }：configured=false 表示缺 ZHIPU_API_KEY（服务未配好）。
export async function onRequestGet(context) {
  const { env, request } = context;
  const origin = String(request.headers.get('origin') || '');
  const h = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify({
    ok: true,
    configured: !!(env && env.ZHIPU_API_KEY),
    ts: Date.now(),
  }), { status: 200, headers: h });
}
