import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const TOKEN = 'synthetic-transport-test-token-0123456789';
const PRINCIPAL = 'synthetic-owner';
const cliPath = fileURLToPath(new URL('../scripts/mcp.mjs', import.meta.url));
const HARNESS_CASES = [
  ['harness_status', {}],
  ['harness_list_workspaces', { offset: 0, limit: 100 }],
  ['harness_list_sessions', { workspace_id: 'synthetic workspace', query: 'synthetic', offset: 1, limit: 2 }],
  ['harness_read_session', { session_id: 'synthetic session', offset: 0, limit: 100 }],
  ['harness_list_directory', { workspace_id: 'synthetic workspace', path: '', offset: 0, limit: 1 }],
  ['harness_read_file', { workspace_id: 'synthetic workspace', path: 'README.md', offset: 0, max_bytes: 32768 }],
];
const NATIVE_JOB_ID = 'native_job_00000000-0000-4000-8000-000000000001';
const NATIVE_CASES = [
  ['harness_start_task', { workspace_id: 'registered-project', task: 'Apply the requested project change.', request_id: 'native-request' }],
  ['harness_get_task', { job_id: NATIVE_JOB_ID }],
  ['harness_list_tasks', { request_id:'native-request', archived:false, limit:10 }],
  ['harness_archive_task', { job_id:NATIVE_JOB_ID, archived:true }],
  ['harness_followup_task', { job_id: NATIVE_JOB_ID, task: 'Verify the previous change.', request_id: 'native-followup' }],
  ['harness_cancel_task', { job_id: NATIVE_JOB_ID }],
];

async function memoryClient(t, options) {
  const { createMcpServer } = await import('../src/mcp.js');
  const server = createMcpServer(options);
  const client = new Client({ name: 'synthetic-harness-read-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function stdioClient(t, env) {
  const client = new Client({ name: 'synthetic-harness-routing-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cliPath], env: { DOT_DSH_TOKEN: TOKEN, ...env }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

function rpc(url, { body = JSON.stringify({ tool: 'list_projects', args: {} }), headers = {}, method = 'POST', path } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(target, {
      method,
      ...(path ? { path } : {}),
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function bridge(t, options = {}) {
  const { createBridge } = await import('../src/bridge.js');
  const calls = [];
  const service = { async call(...args) { calls.push(args); return { synthetic: true, projects: [] }; } };
  const result = await createBridge({ service, token: TOKEN, principal: PRINCIPAL, ...options });
  t.after(() => result.close());
  return { ...result, calls };
}

test('synthetic HTTP: bridge fails closed without a strong token or configured owner', async () => {
  const { createBridge } = await import('../src/bridge.js');
  const service = { call: async () => ({}) };
  for (const token of [undefined, '', 'short', 'x'.repeat(31), 'x'.repeat(32) + '\n']) {
    await assert.rejects(createBridge({ service, token, principal: PRINCIPAL }), /configuration/i);
  }
  await assert.rejects(createBridge({ service, token: TOKEN }), /configuration/i);
  await assert.rejects(createBridge({ service, token: TOKEN, principal: PRINCIPAL, host: '0.0.0.0' }), /configuration/i);
});

test('synthetic HTTP: loopback RPC fixes identity from configuration', async (t) => {
  const endpoint = await bridge(t);
  assert.match(endpoint.url, /^http:\/\/127\.0\.0\.1:\d+\/rpc$/);
  assert.equal(endpoint.calls.length, 0);
  const response = await rpc(endpoint.url);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { result: { synthetic: true, projects: [] } });
  assert.deepEqual(endpoint.calls, [[PRINCIPAL, 'list_projects', {}]]);
  const forged = await rpc(endpoint.url, { body: JSON.stringify({ tool: 'list_projects', args: {}, principal: 'forged' }) });
  assert.equal(forged.status, 400);
  assert.equal(endpoint.calls.length, 1);
});

test('synthetic HTTP: authentication, browser origins and Host are checked before execution', async (t) => {
  const endpoint = await bridge(t);
  for (const headers of [{ authorization: '' }, { authorization: 'Bearer bad' }]) {
    assert.equal((await rpc(endpoint.url, { headers })).status, 401);
  }
  for (const headers of [
    { origin: 'https://attacker.invalid' },
    { origin: 'null' },
    { host: 'attacker.invalid' },
    { host: `localhost:${new URL(endpoint.url).port}` },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    assert.equal((await rpc(endpoint.url, { headers })).status, 403);
  }
  assert.equal(endpoint.calls.length, 0);
});

test('synthetic HTTP: routes, JSON envelope and body size are bounded', async (t) => {
  const endpoint = await bridge(t, { maxBodyBytes: 256 });
  const cases = [
    [{ method: 'GET' }, 405],
    [{ path: '/rpc?tool=list_projects' }, 404],
    [{ path: '/other' }, 404],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: '{' }, 400],
    [{ body: JSON.stringify({ tool: 'unknown', args: {} }) }, 400],
    [{ body: JSON.stringify({ tool: 'list_projects', args: {}, extra: true }) }, 400],
    [{ body: JSON.stringify({ tool: 'list_projects', args: [] }) }, 400],
    [{ body: 'x'.repeat(257) }, 413],
  ];
  for (const [options, status] of cases) assert.equal((await rpc(endpoint.url, options)).status, status);
  assert.equal(endpoint.calls.length, 0);
});

test('synthetic HTTP: service errors are redacted and backend offline stays explicit', async (t) => {
  const endpoint = await bridge(t, { service: { async call() { throw new Error('SECRET /private/alice token=secret'); } } });
  const response = await rpc(endpoint.url);
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.text), { error: { code: 'INTERNAL_ERROR', message: 'Connector operation failed.' } });
  assert.doesNotMatch(response.text, /SECRET|alice|token=/);
  const offline = await bridge(t, { service: { async call() { throw Object.assign(new Error('sensitive details'), { code: 'BACKEND_OFFLINE' }); } } });
  const unavailable = await rpc(offline.url);
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.parse(unavailable.text).error.code, 'BACKEND_OFFLINE');
  assert.doesNotMatch(unavailable.text, /sensitive/);
});

test('synthetic HTTP: known core policy and validation rejections use a fixed public error', async (t) => {
  const { z } = await import('zod');
  let validationError;
  try { z.string().parse(null); } catch (error) { validationError = error; }
  for (const error of [new Error('Job access denied'), new Error('request_id conflict'), new Error('Context exceeds byte limit'), validationError]) {
    const endpoint = await bridge(t, { service: { async call() { throw error; } } });
    const response = await rpc(endpoint.url);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.text), { error: { code: 'BACKEND_REJECTED', message: 'DSH backend rejected the operation.' } });
  }
});

test('synthetic Harness HTTP: reader error codes retain fixed statuses and redact original error text', async (t) => {
  const cases = [
    ['HARNESS_DENIED', 403, 'Harness read access denied.'],
    ['HARNESS_UNAVAILABLE', 503, 'Harness persisted read service is unavailable.'],
    ['HARNESS_RESPONSE_LIMIT', 413, 'Harness read response exceeds the bounded page limit. Use a smaller page.'],
  ];
  for (const [code, status, message] of cases) {
    const endpoint = await bridge(t, { service: { async call() { throw Object.assign(new Error('syntheticsecret /synthetic/private/path token=syntheticsecret'), { code }); } } });
    const result = await rpc(endpoint.url, { body: JSON.stringify({ tool: 'harness_status', args: {} }) });
    assert.equal(result.status, status);
    assert.deepEqual(JSON.parse(result.text), { error: { code, message } });
    assert.doesNotMatch(result.text, /syntheticsecret|synthetic\/private|token=/);
  }
});

test('synthetic HTTP: an unresponsive operation returns a bounded timeout', async (t) => {
  const endpoint = await bridge(t, { requestTimeoutMs: 30, service: { call: () => new Promise(() => {}) } });
  const start = Date.now();
  const response = await rpc(endpoint.url);
  assert.equal(response.status, 504);
  assert.equal(JSON.parse(response.text).error.code, 'REQUEST_TIMEOUT');
  assert.ok(Date.now() - start < 2000);
});

test('synthetic HTTP: chunked request bytes and incomplete bodies remain bounded', async (t) => {
  const endpoint = await bridge(t, { maxBodyBytes: 256, requestTimeoutMs: 40 });
  const sendChunks = (chunks, end) => new Promise((resolve, reject) => {
    const req = http.request(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    chunks.forEach((chunk) => req.write(chunk));
    if (end) req.end();
  });
  assert.equal((await sendChunks(['x'.repeat(150), 'x'.repeat(150)], true)).status, 413);
  assert.equal((await sendChunks(['{"tool":'], false)).status, 504);
  assert.equal(endpoint.calls.length, 0);
});

test('synthetic official SDK: initialize and discovery do not execute tools, calls enforce schema', async (t) => {
  const { createMcpServer } = await import('../src/mcp.js');
  const calls = [];
  const server = createMcpServer({ call: async (...args) => { calls.push(args); return { synthetic: true }; } });
  const client = new Client({ name: 'synthetic-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.equal(client.getServerVersion().name, 'dot-dsh-connector');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ['list_projects', 'read_project_context', 'start_task', 'get_task', 'cancel_task']);
  assert.equal(calls.length, 0);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, !['start_task', 'cancel_task'].includes(tool.name));
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.equal(tools.find((tool) => tool.name === 'start_task').annotations.idempotentHint, true);
  const result = await client.callTool({ name: 'start_task', arguments: { project_id: 'synthetic-project', task: 'Read README', request_id: 'synthetic-request' } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), { synthetic: true });
  assert.deepEqual(calls[0], ['start_task', { project_id: 'synthetic-project', task: 'Read README', request_id: 'synthetic-request' }]);
  for (const args of [{ project_id: 'p', task: 'Read README' }, { project_id: 'p', task: 'Read README', request_id: 'r', principal: 'forged' }]) {
    const invalid = await client.callTool({ name: 'start_task', arguments: args });
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls.length, 1);
});

test('synthetic official SDK: task text and identifiers match core limits', async (t) => {
  const { createMcpServer } = await import('../src/mcp.js');
  const calls = [];
  const server = createMcpServer({ call: async (...args) => { calls.push(args); return { synthetic: true }; } });
  const client = new Client({ name: 'synthetic-limits-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const args of [
    { project_id: '../escape', task: 'Read README', request_id: 'r' },
    { project_id: 'p'.repeat(101), task: 'Read README', request_id: 'r' },
    { project_id: 'p', task: ' ', request_id: 'r' },
    { project_id: 'p', task: 'x'.repeat(2001), request_id: 'r' },
  ]) assert.equal((await client.callTool({ name: 'start_task', arguments: args })).isError, true);
  assert.equal(calls.length, 0);
  const valid = await client.callTool({ name: 'start_task', arguments: { project_id: 'p', task: '  Read README  ', request_id: 'r' } });
  assert.equal(valid.isError, undefined);
  assert.equal(calls[0][1].task, 'Read README');
});

test('synthetic official SDK: stdio CLI calls authenticated HTTP bridge', async (t) => {
  const endpoint = await bridge(t);
  const client = new Client({ name: 'synthetic-stdio-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath],
    env: { DOT_DSH_BRIDGE_URL: endpoint.url, DOT_DSH_TOKEN: TOKEN },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => client.close());
  await client.connect(transport);
  await client.listTools();
  assert.equal(endpoint.calls.length, 0);
  const result = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text).projects, []);
  assert.deepEqual(endpoint.calls, [[PRINCIPAL, 'list_projects', {}]]);
  assert.equal(stderr, '');
});

test('synthetic CLI: rejects non-loopback URLs and argv configuration without leaking secrets', async () => {
  const run = (env, args = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, DOT_DSH_TOKEN: TOKEN, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  for (const url of ['https://127.0.0.1:1234/rpc', 'http://localhost:1234/rpc', 'http://127.0.0.1.attacker.invalid:1234/rpc', 'http://127.0.0.1:1234/rpc?token=SECRET', 'http://user:SECRET@127.0.0.1:1234/rpc']) {
    const result = await run({ DOT_DSH_BRIDGE_URL: url });
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /SECRET|synthetic-transport-test-token/);
    assert.match(result.stderr, /configuration/i);
  }
  const argv = await run({ DOT_DSH_BRIDGE_URL: 'http://127.0.0.1:1234/rpc' }, ['--token', TOKEN]);
  assert.notEqual(argv.code, 0);
  assert.doesNotMatch(argv.stderr, /synthetic-transport-test-token/);
});

test('synthetic CLI: missing backend is explicit through MCP and does not leak environment', async (t) => {
  const unused = http.createServer();
  await new Promise((resolve) => unused.listen(0, '127.0.0.1', resolve));
  const port = unused.address().port;
  await new Promise((resolve) => unused.close(resolve));
  const client = new Client({ name: 'synthetic-offline-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cliPath], env: { DOT_DSH_BRIDGE_URL: `http://127.0.0.1:${port}/rpc`, DOT_DSH_TOKEN: TOKEN }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error.code, 'BACKEND_OFFLINE');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-transport-test-token|ECONNREFUSED|127\.0\.0\.1/);
});

test('synthetic Harness SDK: explicit opt-in adds exactly six read-only tools without discovery execution', async (t) => {
  const calls = [];
  const client = await memoryClient(t, { harnessRead: true, call: async (...args) => { calls.push(args); return { synthetic: true }; } });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 11);
  assert.deepEqual(tools.slice(5).map((tool) => tool.name), HARNESS_CASES.map(([name]) => name));
  assert.equal(calls.length, 0);
  for (const tool of tools.slice(5)) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.match(tools.find((tool) => tool.name === 'harness_read_session').inputSchema.properties.offset.description, /Use returned next_offset; omit\/0 for latest/);
  for (const [name, args] of HARNESS_CASES) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
  }
  assert.deepEqual(calls, HARNESS_CASES);
});

test('synthetic Harness SDK: strict schemas reject excess authority and invalid pagination/string bounds', async (t) => {
  const calls = [];
  const client = await memoryClient(t, { harnessRead: true, call: async (...args) => { calls.push(args); return { synthetic: true }; } });
  const invalid = [
    ['harness_status', { method: 'rpc' }],
    ['harness_status', { url: 'http://synthetic.invalid', headers: {} }],
    ['harness_list_workspaces', { offset: -1 }],
    ['harness_list_workspaces', { offset: 0.5 }],
    ['harness_list_workspaces', { limit: 0 }],
    ['harness_list_workspaces', { limit: 101 }],
    ['harness_list_sessions', { workspace_id: '' }],
    ['harness_list_sessions', { workspace_id: 'x'.repeat(513) }],
    ['harness_list_sessions', { workspace_id: 'line\nbreak' }],
    ['harness_list_sessions', { query: 'x'.repeat(201) }],
    ['harness_list_sessions', { offset: -1 }],
    ['harness_list_sessions', { limit: 101 }],
    ['harness_read_session', {}],
    ['harness_read_session', { session_id: '' }],
    ['harness_read_session', { session_id: 'x'.repeat(257) }],
    ['harness_read_session', { session_id: 'contains\u0085control' }],
    ['harness_read_session', { session_id: 's', limit: 0 }],
    ['harness_list_directory', { workspace_id: 'x'.repeat(513) }],
    ['harness_list_directory', { workspace_id: 'w', path: 'x'.repeat(2001) }],
    ['harness_list_directory', { workspace_id: 'w', offset: -1 }],
    ['harness_list_directory', { workspace_id: 'w', limit: 101 }],
    ['harness_read_file', { workspace_id: 'w' }],
    ['harness_read_file', { workspace_id: 'w', path: '' }],
    ['harness_read_file', { workspace_id: 'w', path: 'README.md', offset: -1 }],
    ['harness_read_file', { workspace_id: 'w', path: 'README.md', max_bytes: 0 }],
    ['harness_read_file', { workspace_id: 'w', path: 'README.md', max_bytes: 32769 }],
    ['harness_read_file', { workspace_id: 'w', path: 'README.md', principal: 'forged' }],
  ];
  for (const [name, args] of invalid) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must reject ${JSON.stringify(args)}`);
  }
  assert.equal(calls.length, 0);
  const boundaryCases = [
    ['harness_list_workspaces', {}],
    ['harness_list_sessions', { workspace_id: 'w'.repeat(512), query: 'q'.repeat(200), limit: 1 }],
    ['harness_read_session', { session_id: 's'.repeat(256), offset: 0, limit: 100 }],
    ['harness_list_directory', { workspace_id: 'w'.repeat(512), path: 'p'.repeat(2000) }],
    ['harness_read_file', { workspace_id: 'w'.repeat(512), path: 'p'.repeat(2000), max_bytes: 32768 }],
  ];
  for (const [name, args] of boundaryCases) assert.equal((await client.callTool({ name, arguments: args })).isError, undefined);
  assert.deepEqual(calls, boundaryCases);
});

test('synthetic Harness SDK: opt-in must be boolean and omitted option keeps Harness tools unavailable', async (t) => {
  const { createMcpServer } = await import('../src/mcp.js');
  assert.throws(() => createMcpServer({ call: async () => ({}), harnessRead: 'true' }), /configuration/i);
  const calls = [];
  const client = await memoryClient(t, { call: async (...args) => { calls.push(args); return {}; } });
  assert.equal((await client.listTools()).tools.length, 5);
  assert.equal((await client.callTool({ name: 'harness_status', arguments: {} })).isError, true);
  assert.equal(calls.length, 0);
});

test('synthetic Harness HTTP: bridge permits the exact twelve read and native names and rejects unknown authority', async (t) => {
  const endpoint = await bridge(t);
  const cases = [...HARNESS_CASES, ...NATIVE_CASES];
  for (const [tool, args] of cases) {
    const result = await rpc(endpoint.url, { body: JSON.stringify({ tool, args }) });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(endpoint.calls, cases.map(([tool, args]) => [PRINCIPAL, tool, args]));
  for (const tool of ['harness_rpc', 'harness_status_extra', 'harness_write_file', 'harness_start_task_extra', 'harness_cancel_session']) {
    assert.equal((await rpc(endpoint.url, { body: JSON.stringify({ tool, args: {} }) })).status, 400);
  }
  assert.equal(endpoint.calls.length, 12);
});

test('synthetic Harness CLI: exact read tools route only to the separate bridge, legacy tools retain their endpoint', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t);
  const harness = await bridge(t);
  const client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url, DOT_DSH_HARNESS_BRIDGE_URL: harness.url });
  assert.equal((await client.listTools()).tools.length, 11);
  assert.equal(legacy.calls.length + harness.calls.length, 0);
  for (const [name, args] of HARNESS_CASES) assert.equal((await client.callTool({ name, arguments: args })).isError, undefined);
  assert.deepEqual(harness.calls, HARNESS_CASES.map(([name, args]) => [PRINCIPAL, name, args]));
  assert.equal(legacy.calls.length, 0);
  await client.callTool({ name: 'list_projects', arguments: {} });
  await client.callTool({ name: 'start_task', arguments: { project_id: 'synthetic-project', task: 'Read synthetic README.', request_id: 'synthetic-request' } });
  assert.deepEqual(legacy.calls.map(([, tool]) => tool), ['list_projects', 'start_task']);
  for (const name of ['harness_rpc', 'harness_status_extra']) assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
  assert.equal(legacy.calls.length, 2);
  assert.equal(harness.calls.length, 6);
});

test('synthetic Harness CLI: unavailable read bridge never falls back to legacy bridge', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t);
  const harness = await bridge(t);
  const harnessUrl = harness.url;
  await harness.close();
  const client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url, DOT_DSH_HARNESS_BRIDGE_URL: harnessUrl });
  const result = await client.callTool({ name: 'harness_status', arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error.code, 'BACKEND_OFFLINE');
  assert.equal(legacy.calls.length, 0);
  assert.equal((await client.callTool({ name: 'list_projects', arguments: {} })).isError, undefined);
  assert.equal(legacy.calls.length, 1);
});

test('synthetic Harness CLI: malformed optional endpoint fails startup without exposing values', { timeout: 60_000 }, async () => {
  for (const url of ['', 'https://127.0.0.1:1234/rpc', 'http://localhost:1234/rpc', 'http://127.0.0.1.attacker.invalid:1234/rpc', 'http://127.0.0.1:1234/rpc?token=SECRET', 'http://user:SECRET@127.0.0.1:1234/rpc']) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath], { env: { DOT_DSH_BRIDGE_URL: 'http://127.0.0.1:1234/rpc', DOT_DSH_HARNESS_BRIDGE_URL: url, DOT_DSH_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /configuration/i);
    assert.doesNotMatch(result.stderr, /SECRET|synthetic-transport-test-token/);
  }
});

test('synthetic native SDK: execution opt-in and fixture disable select exact tool sets without discovery calls', async (t) => {
  const { createMcpServer } = await import('../src/mcp.js');
  for (const options of [{ harnessExecution: 'true' }, { fixtureTasks: 'disabled' }, { fixtureTasks: false }]) {
    assert.throws(() => createMcpServer({ call: async () => ({}), ...options }), /configuration/i);
  }
  for (const [options, names] of [
    [{ harnessExecution: true }, ['list_projects', 'read_project_context', 'start_task', 'get_task', 'cancel_task', ...NATIVE_CASES.map(([name]) => name)]],
    [{ harnessExecution: true, fixtureTasks: false }, NATIVE_CASES.map(([name]) => name)],
    [{ harnessRead: true, harnessExecution: true, fixtureTasks: false }, [...HARNESS_CASES, ...NATIVE_CASES].map(([name]) => name)],
  ]) {
    const calls = [];
    const client = await memoryClient(t, { ...options, call: async (...args) => { calls.push(args); return { synthetic: true }; } });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), names);
    assert.equal(calls.length, 0);
    for (const [name] of NATIVE_CASES) {
      const definition = tools.find(tool => tool.name === name);
      assert.equal(definition.annotations.readOnlyHint, ['harness_get_task','harness_list_tasks'].includes(name));
      assert.equal(definition.annotations.openWorldHint, ['harness_start_task', 'harness_followup_task'].includes(name));
      assert.equal(definition.annotations.destructiveHint, name === 'harness_cancel_task');
      assert.equal(definition.annotations.idempotentHint, true);
      assert.equal(definition.inputSchema.additionalProperties, false);
    }
    if (options.fixtureTasks === false) {
      assert.equal((await client.callTool({ name: 'start_task', arguments: { project_id: 'fixture', task: 'Read README', request_id: 'fixture-request' } })).isError, true);
      assert.equal(calls.length, 0);
    }
  }
});

test('synthetic native SDK: unknown tools and excess native selectors never reach the backend', async (t) => {
  const calls = [];
  const client = await memoryClient(t, { harnessExecution: true, call: async (...args) => { calls.push(args); return {}; } });
  const invalid = [
    ['harness_start_task', { workspace_id: 'registered-project', task: 'Change project', request_id: 'r', session_id: 'foreign-session' }],
    ['harness_start_task', { workspace_id: 'registered-project', task: 'Change project', request_id: 'r', cwd: '/arbitrary/path' }],
    ['harness_start_task', { workspace_id: 'bad\u0000workspace', task: 'Change project', request_id: 'r' }],
    ['harness_start_task', { workspace_id: 'registered-project', task: 'x'.repeat(8001), request_id: 'r' }],
    ['harness_followup_task', { job_id: NATIVE_JOB_ID, task: ' ', request_id: 'r' }],
    ['harness_cancel_task', { job_id: NATIVE_JOB_ID, principal: 'forged' }],
    ['harness_cancel_session', { session_id: 'foreign-session' }],
  ];
  for (const [name, args] of invalid) assert.equal((await client.callTool({ name, arguments: args })).isError, true, name);
  assert.equal(calls.length, 0);
});

test('synthetic native CLI: all six native tools use their dedicated endpoint and never route through fixture or reader', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t), harness = await bridge(t), native = await bridge(t);
  const client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url, DOT_DSH_HARNESS_BRIDGE_URL: harness.url, DOT_DSH_NATIVE_TASKS_URL: native.url });
  assert.equal((await client.listTools()).tools.length, 17);
  assert.equal(legacy.calls.length + harness.calls.length + native.calls.length, 0);
  for (const [name, args] of NATIVE_CASES) assert.equal((await client.callTool({ name, arguments: args })).isError, undefined);
  assert.deepEqual(native.calls, NATIVE_CASES.map(([name, args]) => [PRINCIPAL, name, args]));
  assert.equal(legacy.calls.length + harness.calls.length, 0);
  await client.callTool({ name: 'harness_status', arguments: {} });
  await client.callTool({ name: 'start_task', arguments: { project_id: 'fixture', task: 'Read fixture README', request_id: 'fixture-request' } });
  assert.deepEqual(harness.calls, [[PRINCIPAL, 'harness_status', {}]]);
  assert.deepEqual(legacy.calls.map(([, name]) => name), ['start_task']);
  assert.equal(native.calls.length, 6);
});

test('synthetic native CLI: fixture disable exposes exactly twelve Harness tools and legacy names remain unavailable', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t), harness = await bridge(t), native = await bridge(t);
  const client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url, DOT_DSH_HARNESS_BRIDGE_URL: harness.url, DOT_DSH_NATIVE_TASKS_URL: native.url, DOT_DSH_FIXTURE_TASKS: 'disabled' });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [...HARNESS_CASES, ...NATIVE_CASES].map(([name]) => name));
  assert.equal(tools.length, 12);
  assert.equal(legacy.calls.length + harness.calls.length + native.calls.length, 0);
  for (const [name, args] of [...HARNESS_CASES, ...NATIVE_CASES]) assert.equal((await client.callTool({ name, arguments: args })).isError, undefined);
  for (const [name, args] of [
    ['list_projects', {}],
    ['start_task', { project_id: 'fixture', task: 'Read fixture README', request_id: 'fixture-request' }],
    ['harness_rpc', {}],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal(legacy.calls.length, 0);
  assert.deepEqual(harness.calls, HARNESS_CASES.map(([name, args]) => [PRINCIPAL, name, args]));
  assert.deepEqual(native.calls, NATIVE_CASES.map(([name, args]) => [PRINCIPAL, name, args]));
});

test('synthetic native CLI: unavailable native transport and native errors never fall back to fixture execution', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t), harness = await bridge(t);
  for (const state of ['offline', 'native-unavailable']) {
    const nativeCalls = [];
    const native = await bridge(t, { service: { async call(...args) { nativeCalls.push(args); throw Object.assign(new Error('private native transport detail'), { code: 'NATIVE_UNAVAILABLE' }); } } });
    const nativeUrl = native.url;
    if (state === 'offline') await native.close();
    const client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url, DOT_DSH_HARNESS_BRIDGE_URL: harness.url, DOT_DSH_NATIVE_TASKS_URL: nativeUrl });
    for (const [name, args] of NATIVE_CASES) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).error.code, state === 'offline' ? 'BACKEND_OFFLINE' : 'NATIVE_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(result), /private native|synthetic-transport-test-token|ECONNREFUSED|127\.0\.0\.1/);
    }
    assert.equal(nativeCalls.length, state === 'offline' ? 0 : 6);
    assert.equal(legacy.calls.length + harness.calls.length, 0);
  }
});

test('synthetic native CLI: absent native opt-in keeps native calls unavailable without trying the fixture bridge', { timeout: 60_000 }, async (t) => {
  const legacy = await bridge(t), client = await stdioClient(t, { DOT_DSH_BRIDGE_URL: legacy.url });
  for (const [name, args] of NATIVE_CASES) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal(legacy.calls.length, 0);
});
