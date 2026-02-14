const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Load Config ─────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'agents.json');
let config = { agents: [], port: 3000 };

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    config.agents.forEach(a => {
      if (!conversations[a.id]) conversations[a.id] = [];
    });
  } catch (e) {
    console.error('Could not load agents.json:', e.message);
  }
}

// ── State ───────────────────────────────────────────────────────
const conversations = {};

loadConfig();

// ── Helpers ─────────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

// Call OpenClaw Gateway's OpenAI-compatible API
function callGateway(agent, messages) {
  const payload = JSON.stringify({
    messages: messages,
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: agent.host,
      port: agent.port || 18789,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.token}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Failed to parse gateway response'));
        }
      });
    });
    req.on('error', e => reject(new Error(`Cannot reach ${agent.host}:${agent.port} — ${e.message}`)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out (120s)')); });
    req.write(payload);
    req.end();
  });
}

// Check gateway health
function checkHealth(agent) {
  return new Promise((resolve) => {
    const options = {
      hostname: agent.host,
      port: agent.port || 18789,
      path: '/v1/models',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${agent.token}` },
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { resolve({ online: res.statusCode === 200 || res.statusCode === 401, statusCode: res.statusCode }); });
    });
    req.on('error', () => resolve({ online: false }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ online: false }); });
    req.end();
  });
}

// ── Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Serve dashboard
  if (p === '/' || p === '/index.html') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'));
    } catch {
      res.writeHead(500);
      return res.end('index.html not found');
    }
  }

  // List agents (hide tokens)
  if (p === '/api/agents' && req.method === 'GET') {
    const agentsWithHealth = await Promise.all(config.agents.map(async a => {
      const health = await checkHealth(a);
      return {
        id: a.id, name: a.name, color: a.color || '#3B82F6',
        host: a.host, port: a.port,
        online: health.online,
        messageCount: (conversations[a.id] || []).length,
      };
    }));
    return json(res, 200, agentsWithHealth);
  }

  // Get conversation
  if (/^\/api\/agents\/[^/]+\/conversation$/.test(p) && req.method === 'GET') {
    const id = p.split('/')[3];
    return json(res, 200, { messages: conversations[id] || [] });
  }

  // Chat with agent
  if (/^\/api\/agents\/[^/]+\/chat$/.test(p) && req.method === 'POST') {
    const id = p.split('/')[3];
    const agent = config.agents.find(a => a.id === id);
    if (!agent) return json(res, 404, { error: 'Agent not found' });

    try {
      const b = await readBody(req);
      if (!b.message) return json(res, 400, { error: 'Message required' });

      if (!conversations[id]) conversations[id] = [];
      conversations[id].push({ role: 'user', content: b.message });

      const response = await callGateway(agent, conversations[id]);
      const text = response.choices?.[0]?.message?.content || 'No response';

      conversations[id].push({ role: 'assistant', content: text });

      json(res, 200, { response: text, usage: response.usage });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // Update agent settings
  if (/^\/api\/agents\/[^/]+$/.test(p) && req.method === 'PUT') {
    const id = p.split('/')[3];
    const agent = config.agents.find(a => a.id === id);
    if (!agent) return json(res, 404, { error: 'Agent not found' });
    try {
      const b = await readBody(req);
      if (b.name) agent.name = b.name;
      if (b.color) agent.color = b.color;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // Clear conversation
  if (/^\/api\/agents\/[^/]+\/clear$/.test(p) && req.method === 'POST') {
    const id = p.split('/')[3];
    conversations[id] = [];
    return json(res, 200, { ok: true });
  }

  // Health check
  if (p === '/api/health' && req.method === 'GET') {
    const results = await Promise.all(config.agents.map(async a => ({
      id: a.id, name: a.name, ...(await checkHealth(a)),
    })));
    return json(res, 200, results);
  }

  json(res, 404, { error: 'Not found' });
});

const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`\nOpenClaw Dashboard running on http://localhost:${PORT}`);
  console.log(`Agents: ${config.agents.map(a => `${a.name} (${a.host}:${a.port || 18789})`).join(', ')}\n`);
});
