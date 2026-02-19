import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '.api-config.json');
const DEFAULT_URL = 'https://api.acemusic.ai';

type ApiMode = 'completion' | 'native';

function loadConfig(): { url: string; key: string; mode: ApiMode } {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return { url: raw.url ?? DEFAULT_URL, key: raw.key ?? '', mode: raw.mode ?? 'completion' };
  } catch {
    return { url: DEFAULT_URL, key: '', mode: 'completion' };
  }
}

function saveConfig(config: { url: string; key: string; mode: ApiMode }) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/** Reverse-proxy /api/* to the configured ACE-Step API, injecting auth. */
function proxyApiRequest(req: IncomingMessage, res: ServerResponse) {
  const config = loadConfig();
  const stripped = (req.url ?? '').replace(/^\/api/, '') || '/';
  const target = new URL(stripped, config.url);
  const isHttps = target.protocol === 'https:';
  const doRequest = isHttps ? httpsRequest : httpRequest;

  const headers: Record<string, string> = {};
  // Forward select headers
  for (const h of ['content-type', 'accept', 'content-length']) {
    if (req.headers[h]) headers[h] = req.headers[h] as string;
  }
  if (config.key) {
    headers['authorization'] = `Bearer ${config.key}`;
  }

  const proxyReq = doRequest(
    target,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
}

function apiPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        // Config endpoint
        if (req.url === '/__api-config') {
          if (req.method === 'GET') {
            const config = loadConfig();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ url: config.url, hasKey: !!config.key, mode: config.mode }));
            return;
          }
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: string) => (body += chunk));
            req.on('end', () => {
              const data = JSON.parse(body);
              const config = loadConfig();
              if (data.url !== undefined) config.url = data.url.replace(/\/+$/, '') || DEFAULT_URL;
              if (data.key !== undefined) config.key = data.key;
              if (data.mode === 'completion' || data.mode === 'native') config.mode = data.mode;
              saveConfig(config);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ url: config.url, hasKey: !!config.key, mode: config.mode }));
            });
            return;
          }
          return next();
        }

        // Proxy /api/* requests
        if (req.url?.startsWith('/api')) {
          proxyApiRequest(req, res);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  server: {
    port: 5174,
  },
});
