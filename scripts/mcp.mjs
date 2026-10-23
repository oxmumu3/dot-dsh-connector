#!/usr/bin/env node
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/mcp.js';
import { HARNESS_TOOL_NAMES,NATIVE_TASK_TOOL_NAMES, isValidToken, publicError } from '../src/bridge.js';

const harnessTools = new Set(HARNESS_TOOL_NAMES);
const nativeTools=new Set(NATIVE_TASK_TOOL_NAMES);

function bridgeUrl(value) {
  if (typeof value !== 'string') throw new Error('configuration');
  const url = new URL(value);
  // Require the canonical numeric loopback URL. No DNS, redirects, credentials or query secrets.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || url.username || url.password || url.pathname !== '/rpc' || url.search || url.hash
      || value !== `http://127.0.0.1:${url.port}/rpc`) throw new Error('configuration');
  return url;
}

function configuration() {
  const value = process.env.DOT_DSH_BRIDGE_URL;
  const token = process.env.DOT_DSH_TOKEN;
  if (process.argv.length !== 2 || !isValidToken(token) || typeof value !== 'string') throw new Error('configuration');
  const url = bridgeUrl(value);
  const harnessValue = process.env.DOT_DSH_HARNESS_BRIDGE_URL;
  const harnessUrl = harnessValue === undefined ? undefined : bridgeUrl(harnessValue);
  const nativeValue=process.env.DOT_DSH_NATIVE_TASKS_URL;
  const nativeUrl=nativeValue===undefined?undefined:bridgeUrl(nativeValue);
  const fixture=process.env.DOT_DSH_FIXTURE_TASKS;
  if(fixture!==undefined&&fixture!=='disabled')throw new Error('configuration');
  return { url, harnessUrl, nativeUrl,token,fixtureTasks:fixture!=='disabled' };
}

function bridgeCall({ url, token }, tool, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool, args });
    const req = http.request(url, {
      method: 'POST',
      agent: false,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          req.destroy();
          reject(Object.assign(new Error('unavailable'), { code: 'BACKEND_OFFLINE' }));
        } else chunks.push(chunk);
      });
      res.on('error', () => reject(Object.assign(new Error('unavailable'), { code: 'BACKEND_OFFLINE' })));
      res.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200 || !Object.hasOwn(value, 'result')) {
            const safe = publicError(value?.error);
            reject(Object.assign(new Error(safe.message), { code: safe.code }));
          } else resolve(value.result);
        } catch {
          reject(Object.assign(new Error('unavailable'), { code: 'BACKEND_OFFLINE' }));
        }
      });
    });
    req.setTimeout(12_000, () => {
      req.destroy();
      reject(Object.assign(new Error('timeout'), { code: 'REQUEST_TIMEOUT' }));
    });
    req.on('error', () => reject(Object.assign(new Error('unavailable'), { code: 'BACKEND_OFFLINE' })));
    req.end(body);
  });
}

try {
  const config = configuration();
  const server = createMcpServer({
    harnessRead: config.harnessUrl !== undefined,
    harnessExecution:config.nativeUrl!==undefined,
    fixtureTasks:config.fixtureTasks,
    call: (tool, args) => {
      const url = nativeTools.has(tool)?config.nativeUrl:harnessTools.has(tool) ? config.harnessUrl : config.url;
      if (!url) throw Object.assign(new Error('unavailable'), { code: 'BACKEND_OFFLINE' });
      return bridgeCall({ url, token: config.token }, tool, args);
    },
  });
  // stdout belongs exclusively to MCP JSON-RPC. Operational errors use fixed stderr text.
  await server.connect(new StdioServerTransport());
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  process.stderr.write('Dot DSH connector: invalid configuration or startup failure.\n');
  process.exitCode = 1;
}
