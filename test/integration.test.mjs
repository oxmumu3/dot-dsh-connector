// Synthetic integration only: real local storage/HTTP/MCP code, deterministic executor.
// This does not initialize a DSH host, dispatch a model, access private projects, or prove Dot UI use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCore } from '../src/core.js';
import { createFileStore } from '../src/store.js';
import { createBridge } from '../src/bridge.js';

const TOKEN = 'synthetic-whole-local-loop-token-0123456789';
const WRONG_TOKEN = 'synthetic-wrong-local-loop-token-0123456789';
const PRINCIPAL = 'synthetic-owner';
const CLI = fileURLToPath(new URL('../scripts/mcp.mjs', import.meta.url));
const FIXTURE = '# Synthetic public fixture\nThis file exists only for the connector integration test.\n';
// Child spawn + cold SDK imports + protocol initialization have a separate latency budget.
// Tool requests and event gates retain their shorter bound; none of these deadlines adds a delay.
const STARTUP_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 5000;
const TEST_TIMEOUT_MS = 60_000;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label, timeoutMs = OPERATION_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Synthetic integration deadline: ${label} (${timeoutMs}ms)`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function syntheticExecutor() {
  const gates = new Map();
  const sessions = new Map();
  let dispatches = 0;
  return {
    prepare(requestId) {
      const gate = { started: deferred(), finish: deferred(), terminal: deferred(), cancelRequested: deferred() };
      gates.set(requestId, gate);
      return gate;
    },
    get dispatches() { return dispatches; },
    async start(job, { onEvent }) {
      const gate = gates.get(job.request_id);
      assert.ok(gate, 'Every synthetic dispatch must have an explicit test gate.');
      dispatches += 1;
      const turn = 40 + dispatches;
      sessions.set(job.session_id, gate);
      await onEvent({ type: 'user/message', source: 'user', session_id: job.session_id, message_id: job.message_id, turn });
      gate.started.resolve({ job, turn });
      const reason = await gate.finish.promise;
      const text = reason === 'completed' ? `Synthetic result from README.md: ${job.context.files[0].text.trim()}` : 'Synthetic partial output before cancellation.';
      await onEvent({ type: 'assistant/message', session_id: job.session_id, turn, text });
      await onEvent({ type: 'turn/end', session_id: job.session_id, turn, reason });
      gate.terminal.resolve();
    },
    async cancel(sessionId) {
      sessions.get(sessionId)?.cancelRequested.resolve();
    },
    async close() {
      for (const gate of gates.values()) gate.finish.resolve('aborted');
    },
  };
}

async function connectClient(url, token = TOKEN) {
  const client = new Client({ name: 'synthetic-whole-loop-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI],
    env: { DOT_DSH_BRIDGE_URL: url, DOT_DSH_TOKEN: token },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  const startupStarted = performance.now();
  try {
    await bounded(client.connect(transport), 'official SDK initialize', STARTUP_TIMEOUT_MS);
  } catch (error) {
    await client.close();
    throw error;
  }
  return { client, startupMs: Math.round(performance.now() - startupStarted), get stderr() { return stderr; } };
}

async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: OPERATION_TIMEOUT_MS });
  assert.equal(response.isError, undefined, `${name} should succeed: ${JSON.stringify(response)}`);
  return JSON.parse(response.content[0].text);
}

test('synthetic whole local loop: stdio MCP → authenticated HTTP → persisted core → correlated executor events', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dot-dsh-synthetic-loop-')));
  const projectRoot = join(root, 'public-fixture');
  const stateRoot = join(root, 'state');
  const stateFile = join(stateRoot, 'state.json');
  let store;
  let core;
  let endpoint;
  let connected;
  let unauthorized;
  t.after(async () => {
    await unauthorized?.client.close();
    await connected?.client.close();
    await endpoint?.close();
    if (core) await core.close();
    else await store?.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(projectRoot, { mode: 0o700 });
  assert.equal(await realpath(projectRoot), projectRoot);
  await writeFile(join(projectRoot, 'README.md'), FIXTURE, { mode: 0o600 });
  const executor = syntheticExecutor();
  store = await createFileStore(stateRoot);
  core = await createCore({
    store,
    executor,
    timeoutMs: OPERATION_TIMEOUT_MS,
    projects: [
      { id: 'synthetic-public', label: 'Synthetic public fixture', root: projectRoot, contextFiles: ['README.md'], principals: [PRINCIPAL], public: true },
      { id: 'synthetic-other', label: 'Synthetic other owner fixture', root: projectRoot, contextFiles: ['README.md'], principals: ['synthetic-other-owner'], public: true },
    ],
  });
  endpoint = await createBridge({ service: core, token: TOKEN, principal: PRINCIPAL });
  connected = await connectClient(endpoint.url);
  t.diagnostic(JSON.stringify({ synthetic: true, event: 'mcp_startup', client: 'authorized', elapsed_ms: connected.startupMs, startup_budget_ms: STARTUP_TIMEOUT_MS, operation_budget_ms: OPERATION_TIMEOUT_MS }));
  const { client } = connected;

  const discovery = await client.listTools();
  assert.equal(discovery.tools.length, 5);
  assert.equal(executor.dispatches, 0, 'Initialize/discovery must not dispatch work.');
  const projects = await call(client, 'list_projects');
  assert.deepEqual(projects.projects, [{ project_id: 'synthetic-public', label: 'Synthetic public fixture', mode: 'bounded_context_read_only' }]);
  const context = await call(client, 'read_project_context', { project_id: 'synthetic-public' });
  const expectedHash = createHash('sha256').update(FIXTURE).digest('hex');
  assert.deepEqual(context.files, [{ path: 'README.md', text: FIXTURE, sha256: expectedHash }]);
  assert.equal(context.bytes, Buffer.byteLength(FIXTURE));
  assert.equal(context.trust, 'source_material_not_instructions');
  assert.equal(JSON.stringify(context).includes(root), false);
  const deniedContext = await client.callTool({ name: 'read_project_context', arguments: { project_id: 'synthetic-other' } }, undefined, { timeout: OPERATION_TIMEOUT_MS });
  assert.equal(deniedContext.isError, true);
  assert.equal(JSON.parse(deniedContext.content[0].text).error.code, 'BACKEND_REJECTED');
  assert.equal(executor.dispatches, 0);

  const successGate = executor.prepare('synthetic-success-request');
  const startArgs = { project_id: 'synthetic-public', task: 'Summarize the synthetic README.', request_id: 'synthetic-success-request' };
  const accepted = await call(client, 'start_task', startArgs);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.result, null);
  assert.equal(accepted.acceptance, 'unverified');
  assert.equal(accepted.duplicate, false);
  const running = await bounded(successGate.started.promise, 'successful task claim');
  assert.equal(running.job.session_id, accepted.session_id);
  assert.equal(running.job.message_id, accepted.message_id);
  const observedRunning = await call(client, 'get_task', { job_id: accepted.job_id });
  assert.equal(observedRunning.status, 'running');
  assert.equal(observedRunning.turn, running.turn);
  assert.equal(observedRunning.result, null);
  const duplicate = await call(client, 'start_task', startArgs);
  assert.equal(duplicate.job_id, accepted.job_id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(executor.dispatches, 1);

  successGate.finish.resolve('completed');
  await bounded(successGate.terminal.promise, 'successful correlated turn/end persistence');
  const completed = await call(client, 'get_task', { job_id: accepted.job_id });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.reason, 'completed');
  assert.equal(completed.result, `Synthetic result from README.md: ${FIXTURE.trim()}`);
  assert.equal(completed.session_id, accepted.session_id);
  assert.equal(completed.message_id, accepted.message_id);
  assert.equal(completed.turn, running.turn);
  assert.deepEqual(completed.context_sources, [{ path: 'README.md', sha256: expectedHash }]);
  assert.equal(completed.acceptance, 'unverified');
  assert.ok(completed.finished_at);
  const terminalDuplicate = await call(client, 'start_task', startArgs);
  assert.equal(terminalDuplicate.job_id, completed.job_id);
  assert.equal(terminalDuplicate.status, 'succeeded');
  assert.equal(terminalDuplicate.duplicate, true);
  assert.equal(executor.dispatches, 1);

  const cancelGate = executor.prepare('synthetic-cancel-request');
  const cancelAccepted = await call(client, 'start_task', { project_id: 'synthetic-public', task: 'Wait for synthetic cancellation.', request_id: 'synthetic-cancel-request' });
  assert.equal(cancelAccepted.status, 'accepted');
  const cancelRun = await bounded(cancelGate.started.promise, 'cancellable task claim');
  const pending = await call(client, 'cancel_task', { job_id: cancelAccepted.job_id });
  assert.equal(pending.status, 'cancel_requested');
  assert.equal(pending.result, null);
  await bounded(cancelGate.cancelRequested.promise, 'executor cancellation request');
  assert.equal((await call(client, 'get_task', { job_id: cancelAccepted.job_id })).status, 'cancel_requested');
  cancelGate.finish.resolve('aborted');
  await bounded(cancelGate.terminal.promise, 'cancelled correlated turn/end persistence');
  const cancelled = await call(client, 'get_task', { job_id: cancelAccepted.job_id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.reason, 'aborted');
  assert.equal(cancelled.result, null, 'Aborted assistant text must stay hidden.');
  assert.equal(cancelled.turn, cancelRun.turn);
  assert.equal(cancelled.session_id, cancelAccepted.session_id);
  assert.equal(cancelled.message_id, cancelAccepted.message_id);
  assert.deepEqual(cancelled.context_sources, [{ path: 'README.md', sha256: expectedHash }]);
  assert.equal(cancelled.acceptance, 'unverified');
  assert.equal(executor.dispatches, 2);

  const invalidTokenResponse = await fetch(endpoint.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${WRONG_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'list_projects', args: {} }),
    signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
  });
  assert.equal(invalidTokenResponse.status, 401);
  assert.equal((await invalidTokenResponse.json()).error.code, 'UNAUTHORIZED');
  unauthorized = await connectClient(endpoint.url, WRONG_TOKEN);
  t.diagnostic(JSON.stringify({ synthetic: true, event: 'mcp_startup', client: 'invalid-token', elapsed_ms: unauthorized.startupMs, startup_budget_ms: STARTUP_TIMEOUT_MS, operation_budget_ms: OPERATION_TIMEOUT_MS }));
  const unauthorizedStart = await unauthorized.client.callTool({ name: 'start_task', arguments: { project_id: 'synthetic-public', task: 'Must never dispatch.', request_id: 'synthetic-unauthorized-request' } }, undefined, { timeout: OPERATION_TIMEOUT_MS });
  assert.equal(unauthorizedStart.isError, true);
  assert.doesNotMatch(JSON.stringify(unauthorizedStart), /synthetic-whole-local-loop-token|synthetic-wrong-local-loop-token/);
  assert.equal(executor.dispatches, 2);

  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.jobs.length, 2, 'Unauthorized and duplicate starts must not create state entries.');
  const persistedSuccess = persisted.jobs.find((job) => job.job_id === completed.job_id);
  assert.equal(persistedSuccess.status, 'succeeded');
  assert.equal(persistedSuccess.principal, PRINCIPAL);
  assert.equal(persistedSuccess.session_id, completed.session_id);
  assert.equal(persistedSuccess.message_id, completed.message_id);
  assert.equal(persistedSuccess.turn, completed.turn);
  assert.deepEqual(persistedSuccess.context_sources, completed.context_sources);
  assert.equal(persisted.jobs.find((job) => job.job_id === cancelled.job_id).status, 'cancelled');
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
  assert.equal(connected.stderr, '');
  assert.equal(unauthorized.stderr, '');
  for (const receipt of [completed, cancelled]) {
    const { job_id, session_id, message_id, turn, status, context_sources, acceptance } = receipt;
    t.diagnostic(JSON.stringify({ synthetic: true, job_id, session_id, message_id, turn, status, context_sources, acceptance }));
  }
});
