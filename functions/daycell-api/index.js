// daycell-api 云函数骨架：HTTP 总入口
// 用法：前端 HTTPS 调用本函数 URL，路径路由分发；所有响应带 CORS 头
exports.main = async (event, context) => {
  const method = event.httpMethod || 'GET';
  const path = (event.path || '/').split('?')[0];

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // CORS 预检
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // 健康检查
  if (path === '/health' && method === 'GET') {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, service: 'daycell-api', version: 'v0.1', time: new Date().toISOString() }),
    };
  }

  // 未实现路径
  return {
    statusCode: 404,
    headers: cors,
    body: JSON.stringify({ ok: false, error: 'not_found', path: path }),
  };
};
