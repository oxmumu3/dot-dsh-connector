import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PRINCIPAL = 'probe-owner';
const TOKEN = 'probe-test-only-token-01234567890123456789';
const TEXT = '# Public read-only probe fixture\nActual local bytes; no model execution.\n';
const MODE = { connection_mode: 'read_only_probe', task_execution: 'unavailable', synthetic: false };
const probeScript = fileURLToPath(new URL('../scripts/probe.mjs', import.meta.url));
const mcpScript = fileURLToPath(new URL('../scripts/mcp.mjs', import.meta.url));

async function bounded(promise, ms = 5000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe test deadline exceeded.')), ms); })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dot-dsh-probe-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'README.md'), TEXT, { mode: 0o600 });
  const project = { id: 'probe-public', label: 'Public probe fixture', root, contextFiles: ['README.md'], principals: [PRINCIPAL], public: true };
  return { root, project };
}

test('read-only probe reads actual authorized public bytes and labels task execution unavailable', async (t) => {
  const { createProbeService } = await import('../src/probe.js');
  const { root, project } = await fixture(t);
  const service = createProbeService({ projects: [project], principal: PRINCIPAL });
  assert.deepEqual(Object.keys(service), ['call']);
  assert.deepEqual(await readdir(root), ['README.md'], 'Creation must not create jobs, queues, or state.');
  assert.deepEqual(await service.call(PRINCIPAL, 'list_projects', {}), { ...MODE, projects: [{ project_id: project.id, label: project.label, mode: 'bounded_context_read_only' }] });
  const context = await service.call(PRINCIPAL, 'read_project_context', { project_id: project.id });
  assert.deepEqual(context, {
    ...MODE,
    project_id: project.id,
    files: [{ path: 'README.md', text: TEXT, sha256: createHash('sha256').update(TEXT).digest('hex') }],
    bytes: Buffer.byteLength(TEXT),
    trust: 'source_material_not_instructions',
  });
  assert.equal(JSON.stringify(context).includes(root), false);
  assert.deepEqual(await readdir(root), ['README.md']);
});

test('probe fixes principal, rejects task tools before reading files, and validates read args strictly', async (t) => {
  const { createProbeService } = await import('../src/probe.js');
  const { root, project } = await fixture(t);
  const service = createProbeService({ projects: [project], principal: PRINCIPAL });
  for (const tool of ['list_projects', 'read_project_context', 'start_task', 'get_task', 'cancel_task']) {
    await assert.rejects(service.call('another-owner', tool, {}), { code: 'BACKEND_REJECTED' });
  }
  await rm(join(root, 'README.md'));
  for (const tool of ['start_task', 'get_task', 'cancel_task']) {
    for (const args of [{}, undefined, null, { principal: 'forged', task: 'Must not run.' }]) {
      await assert.rejects(service.call(PRINCIPAL, tool, args), { code: 'BACKEND_OFFLINE' });
    }
  }
  for (const [tool, args] of [
    ['list_projects', { principal: PRINCIPAL }],
    ['list_projects', []],
    ['list_projects', undefined],
    ['read_project_context', {}],
    ['read_project_context', { project_id: project.id, extra: true }],
    ['read_project_context', { project_id: '../escape' }],
    ['read_project_context', { project_id: 'not-allowlisted' }],
    ['__proto__', {}],
  ]) await assert.rejects(service.call(PRINCIPAL, tool, args));
  assert.deepEqual(await readdir(root), [], 'Disabled task tools must not create work or require context reads.');
});

test('probe creation rejects non-public projects, missing ownership, and invalid principals', async (t) => {
  const { createProbeService } = await import('../src/probe.js');
  const { project } = await fixture(t);
  for (const config of [
    { projects: [{ ...project, public: false }], principal: PRINCIPAL },
    { projects: [project], principal: '../bad' },
    { projects: [project], principal: 'not-allowlisted' },
    { projects: [], principal: PRINCIPAL },
  ]) assert.throws(() => createProbeService(config));
});

function launch(configPath, args = [], overrides = {}) {
  const child = spawn(process.execPath, [probeScript, ...args], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', DOT_DSH_CONFIG: configPath, DOT_DSH_PROBE_TEST_TOKEN: TOKEN, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = ''; let readyResolve; let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('\n')) {
      try { readyResolve(JSON.parse(stdout.slice(0, stdout.indexOf('\n')))); } catch { readyReject(new Error('Invalid probe readiness output.')); }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', (error) => { readyReject(error); reject(error); });
    child.once('close', (code, signal) => { readyReject(new Error('Probe closed before readiness.')); resolve({ code, signal }); });
  });
  return {
    child, ready, closed,
    get stdout() { return stdout; }, get stderr() { return stderr; },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      try { return await bounded(closed); } catch { child.kill('SIGKILL'); return bounded(closed); }
    },
  };
}

test('probe launcher serves real public bytes over official MCP stdio and cleanly stops', { timeout: 60_000 }, async (t) => {
  const { root, project } = await fixture(t);
  const configPath = join(root, 'probe-config.json');
  const stateDir = join(root, 'must-not-create-state');
  await writeFile(configPath, JSON.stringify({ enabled: false, publicOnlyHost: true, principal: PRINCIPAL, tokenEnv: 'DOT_DSH_PROBE_TEST_TOKEN', port: 0, stateDir, isolatedHostHome: join(root, 'must-not-access-host'), projects: [project] }));
  const processUnderTest = launch(configPath);
  let client;
  t.after(async () => { await client?.close(); await processUnderTest.stop(); });
  const readiness = await bounded(processUnderTest.ready, 30_000);
  assert.deepEqual({ ...readiness, url: undefined }, { ...MODE, url: undefined });
  assert.match(readiness.url, /^http:\/\/127\.0\.0\.1:\d+\/rpc$/);
  assert.doesNotMatch(processUnderTest.stdout, new RegExp(TOKEN));
  client = new Client({ name: 'actual-read-only-probe-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [mcpScript], env: { DOT_DSH_BRIDGE_URL: readiness.url, DOT_DSH_TOKEN: TOKEN }, stderr: 'pipe' });
  await bounded(client.connect(transport), 30_000);
  assert.equal((await client.listTools()).tools.length, 5);
  const result = await client.callTool({ name: 'read_project_context', arguments: { project_id: project.id } }, undefined, { timeout: 5000 });
  assert.equal(result.isError, undefined);
  const context = JSON.parse(result.content[0].text);
  assert.equal(context.files[0].text, await readFile(join(root, 'README.md'), 'utf8'));
  assert.equal(context.connection_mode, MODE.connection_mode);
  assert.equal(context.task_execution, MODE.task_execution);
  assert.equal(context.synthetic, false);
  for (const [name, args] of [
    ['start_task', { project_id: project.id, task: 'Must not execute.', request_id: 'probe-denied' }],
    ['get_task', { job_id: 'no-job' }],
    ['cancel_task', { job_id: 'no-job' }],
  ]) {
    const denied = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
    assert.equal(denied.isError, true);
    assert.equal(JSON.parse(denied.content[0].text).error.code, 'BACKEND_OFFLINE');
  }
  const unauthorized = await fetch(readiness.url, { method: 'POST', headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'list_projects', args: {} }), signal: AbortSignal.timeout(5000) });
  assert.equal(unauthorized.status, 401);
  await unauthorized.text();
  assert.deepEqual((await readdir(root)).sort(), ['README.md', 'probe-config.json']);
  await client.close();
  assert.equal((await processUnderTest.stop()).code, 0);
  assert.equal(processUnderTest.stderr, '');
});

test('probe launcher rejects relative config, missing token, unsafe config and argv without leaking values', { timeout: 60_000 }, async (t) => {
  const { root, project } = await fixture(t);
  const configPath = join(root, 'config.json');
  const config = { publicOnlyHost: true, principal: PRINCIPAL, tokenEnv: 'DOT_DSH_PROBE_TEST_TOKEN', port: 0, projects: [project] };
  await writeFile(configPath, JSON.stringify(config));
  const cases = [
    () => launch('relative-config.json'),
    () => launch(configPath, ['--config', 'SECRET']),
    () => launch(configPath, [], { DOT_DSH_PROBE_TEST_TOKEN: '' }),
  ];
  for (const start of cases) {
    const run = start();
    t.after(() => run.stop());
    const result = await bounded(run.closed, 30_000);
    assert.equal(result.code, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /configuration|startup/i);
    assert.doesNotMatch(run.stderr, /SECRET|probe-test-only-token|dot-dsh-probe-/);
  }
  await writeFile(configPath, JSON.stringify({ ...config, publicOnlyHost: false }));
  const unsafe = launch(configPath);
  t.after(() => unsafe.stop());
  assert.equal((await bounded(unsafe.closed, 30_000)).code, 1);
  assert.equal(unsafe.stdout, '');
});
