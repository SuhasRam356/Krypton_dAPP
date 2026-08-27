/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
const Gun = require('gun');
const http = require('http');

const PORT = process.env.PORT || 8765;

const server = http.createServer((req, res) => {
  // ── CORS Headers ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── Health Endpoint (for Render/Railway/Vercel) ──
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
    return;
  }
  
  // Let Gun.js handle other routes, particularly the WebSocket upgrades on /gun
});

server.listen(PORT, () => {
    console.log(`Gun relay running on port ${PORT}`);
    console.log(`WebSocket path: ws://localhost:${PORT}/gun`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Configure Gun with explicit radisk (persistence) enabled
const gun = Gun({ 
  web: server,
  radisk: true
});

