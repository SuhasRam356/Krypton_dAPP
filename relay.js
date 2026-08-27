/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http');
const Gun = require('gun');

const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.GUN_DATA_DIR || 'radata';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.RELAY_CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.url?.startsWith('/gun')) {
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'krypton-gun-relay' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Krypton Gun relay. WebSocket endpoint: /gun\n');
});

Gun({ web: server, radisk: true, file: dataDir });

server.listen(port, host, () => {
  console.log(`Gun relay running on http://${host}:${port}/gun`);
});
