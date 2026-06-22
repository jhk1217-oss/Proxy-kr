// 한국 IP 프록시 (다중 사이트, 동적 전환)
// 환경변수로 사이트를 지정하지 않습니다. 프록시 페이지에서 주소를 입력하면
// 그 사이트가 한국 IP로 열리고, 위쪽 바에서 언제든 다른 사이트로 바꿀 수 있습니다.

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());

// 현재 대상 사이트 (쿠키에 저장)
function currentTarget(req) {
  const host = req.cookies['pxhost'];
  const proto = req.cookies['pxproto'] || 'https';
  if (!host) return null;
  return { host, origin: `${proto}://${host}` };
}

// 주소 입력 페이지
app.get('/__px/home', (req, res) => {
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="ko"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>한국 프록시</title>
  <body style="font-family:-apple-system,sans-serif;max-width:600px;margin:40px auto;padding:0 16px">
    <h2>한국 프록시</h2>
    <form action="/__px/set" method="get">
      <input name="url" placeholder="https://사이트주소.com" autofocus
        style="width:100%;box-sizing:border-box;padding:14px;font-size:16px;border:1px solid #ccc;border-radius:8px">
      <button style="margin-top:12px;padding:14px 24px;font-size:16px;border:0;border-radius:8px;background:#111;color:#fff">
        접속</button>
    </form>
    <p style="color:#666;line-height:1.6">접속할 사이트 주소를 넣으면 한국 IP로 열립니다.<br>
    다른 사이트로 바꾸려면 화면 위쪽의 <b>다른 사이트</b> 버튼을 누르거나 이 페이지로 다시 오세요.</p>
    <p style="color:#999"><a href="/__px/ip">서버 IP 확인 (KR 인지 체크)</a></p>
  </body></html>`);
});

// 대상 사이트 지정 → 쿠키 저장 후 그 사이트로 이동
app.get('/__px/set', (req, res) => {
  let url = (req.query.url || '').trim();
  if (!url) return res.redirect('/__px/home');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try { u = new URL(url); } catch { return res.redirect('/__px/home'); }
  res.cookie('pxhost', u.host, { sameSite: 'lax' });
  res.cookie('pxproto', u.protocol.replace(':', ''), { sameSite: 'lax' });
  res.redirect((u.pathname || '/') + (u.search || ''));
});

// 서버 아웃바운드 IP 확인용 (country: KR 이어야 정상)
app.get('/__px/ip', async (req, res) => {
  try { const r = await fetch('https://ipinfo.io/json'); res.json(await r.json()); }
  catch (e) { res.status(500).send(String(e)); }
});

// 그 외 모든 요청 → 현재 대상 사이트로 프록시
app.use('/',
  (req, res, next) => {
    const t = currentTarget(req);
    if (!t) return res.redirect('/__px/home');
    req._target = t;
    next();
  },
  createProxyMiddleware({
    target: 'http://localhost',     // placeholder, 실제 대상은 router 가 결정
    router: (req) => req._target.origin,
    changeOrigin: true,
    ws: true,
    secure: false,
    followRedirects: false,
    selfHandleResponse: true,
    cookieDomainRewrite: '',
    onProxyReq(proxyReq, req) {
      proxyReq.setHeader('referer', req._target.origin + '/');
      proxyReq.setHeader('origin', req._target.origin);
    },
    onProxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      res.removeHeader('content-security-policy');
      res.removeHeader('content-security-policy-report-only');
      res.removeHeader('x-frame-options');

      const targetHost = req._target.host;
      const proxyHost = req.headers.host;

      const loc = proxyRes.headers['location'];
      if (loc) res.setHeader('location', loc.split(targetHost).join(proxyHost));

      const ct = String(proxyRes.headers['content-type'] || '');
      if (/(text|javascript|json|html|xml)/i.test(ct)) {
        let body = buffer.toString('utf8');
        body = body
          .split('https://' + targetHost).join('https://' + proxyHost)
          .split('http://' + targetHost).join('https://' + proxyHost)
          .split('//' + targetHost).join('//' + proxyHost);

        // HTML 이면 상단에 '다른 사이트' 전환 바 삽입
        if (ct.includes('html')) {
          const bar = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;font:13px -apple-system,sans-serif;padding:7px 12px;display:flex;gap:10px;align-items:center;box-sizing:border-box">`
            + `<b>KR프록시</b><span style="opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${targetHost}</span>`
            + `<a href="/__px/home" style="margin-left:auto;color:#7cc4ff;text-decoration:none;flex:none">다른 사이트 ▾</a></div>`
            + `<div style="height:32px"></div>`;
          body = body.replace(/<body[^>]*>/i, (m) => m + bar);
        }
        return body;
      }
      return buffer;
    }),
  })
);

app.listen(PORT, () => console.log(`프록시 실행: 포트 ${PORT}`));
