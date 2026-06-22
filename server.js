// 한국 IP 우회 프록시 (단일 사이트 전용)
// 환경변수 TARGET 에 접속할 사이트 주소를 넣으면, 그 사이트를
// 이 서버(한국)에서 대신 받아와 보여줍니다. => 사이트는 한국 IP로 인식.

const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET = (process.env.TARGET || '').trim().replace(/\/+$/, '');

if (!TARGET) {
  console.error('[설정 오류] 환경변수 TARGET 이 필요합니다. 예: https://example.co.kr');
  process.exit(1);
}

let targetHost;
try {
  targetHost = new URL(TARGET).host;
} catch (e) {
  console.error('[설정 오류] TARGET 형식이 잘못됨. https:// 부터 정확히 넣으세요.');
  process.exit(1);
}

// 이 서버의 실제 '나가는 IP'를 확인하는 용도. 배포 후 /__ip 로 접속해서
// "country": "KR" 인지 반드시 먼저 확인하세요. KR 이 아니면 우회가 안 됩니다.
app.get('/__ip', async (req, res) => {
  try {
    const r = await fetch('https://ipinfo.io/json');
    res.json(await r.json());
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,        // 대상 사이트에 올바른 Host 전달
  ws: true,                  // 웹소켓 지원
  secure: false,
  followRedirects: false,
  selfHandleResponse: true,  // 응답 본문 직접 처리 (URL 재작성)
  cookieDomainRewrite: '',   // 로그인 쿠키가 프록시 주소에 붙도록
  onProxyReq(proxyReq) {
    proxyReq.setHeader('referer', TARGET + '/');
    proxyReq.setHeader('origin', TARGET);
  },
  onProxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
    // 임베드/로딩을 막는 헤더 제거
    res.removeHeader('content-security-policy');
    res.removeHeader('content-security-policy-report-only');
    res.removeHeader('x-frame-options');

    const proxyHost = req.headers.host;

    // 리다이렉트 주소를 프록시 주소로 바꿔 계속 우회 유지
    const loc = proxyRes.headers['location'];
    if (loc) {
      res.setHeader('location', loc.split(targetHost).join(proxyHost));
    }

    // HTML/JS/JSON 안에 박힌 대상 도메인을 프록시 도메인으로 치환
    const ct = String(proxyRes.headers['content-type'] || '');
    if (/(text|javascript|json|html|xml)/i.test(ct)) {
      let body = buffer.toString('utf8');
      body = body
        .split('https://' + targetHost).join('https://' + proxyHost)
        .split('http://' + targetHost).join('https://' + proxyHost)
        .split('//' + targetHost).join('//' + proxyHost);
      return body;
    }
    return buffer;
  }),
}));

app.listen(PORT, () => {
  console.log(`프록시 실행: 포트 ${PORT} → ${TARGET}`);
});
