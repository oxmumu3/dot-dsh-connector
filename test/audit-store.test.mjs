import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, mkdir, readFile, writeFile, chmod, lstat, symlink, link, unlink, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const implementation = await import('../src/audit-store.js').catch(error => error.code === 'ERR_MODULE_NOT_FOUND' ? {} : Promise.reject(error));
const secret = 'sk-syntheticSecret123456789012345';
const principal = 'synthetic-owner';
const fileName = 'connector-manager-state.json';
const ownedJob = (overrides = {}) => ({
  job_id: `job_${randomUUID()}`, principal, project_id: 'public-fixture', request_id: 'synthetic-request',
  fingerprint: 'f'.repeat(64), task: `Read README password=${secret}`, session_id: `dsh_dot_${randomUUID()}`,
  message_id: randomUUID(), turn: 0, status: 'succeeded', result: `Synthetic result token=${secret}`,
  result_truncated: false, reason: 'completed', created_at: '2026-10-19T00:00:00.000Z',
  finished_at: '2026-10-19T00:00:01.000Z', context_sources: [{path: 'README.md', sha256: 'a'.repeat(64)}],
  acceptance: 'unverified', ...overrides,
});
async function fixture(t) {
  assert.equal(typeof implementation.createAuditStore, 'function', 'createAuditStore must be exported');
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dot-audit-synthetic-')));
  await chmod(home, 0o700);
  const stores = [];
  t.after(async () => {await Promise.allSettled(stores.map(store => store.close())); await rm(home, {recursive: true, force: true});});
  const directory = join(home, 'manager');
  const open = async () => {const store = await implementation.createAuditStore({directory, principal}); stores.push(store); return store;};
  return {home, directory, open};
}
const begin = (store, extra = {}) => store.begin({tool: 'harness_read_file', category: 'read', selectors: {workspace_id: 'synthetic-workspace', path: 'README.md'}, ...extra});

/** Build a real persisted template once, then seed a bounded synthetic recovery
 * fixture while its store is closed. This exercises the ordinary startup reader
 * and real boundary writes without hundreds of redundant fsyncs. No production
 * hooks, filesystem mocks or real owner state are involved.
 */
async function seededFixture(t, {events = 0, outcome = 'succeeded', jobs = 0} = {}) {
  const f = await fixture(t), templateStore = await f.open();
  const id = await begin(templateStore);
  await templateStore.finish(id, {outcome: 'succeeded', ...(jobs ? {job: ownedJob()} : {})});
  await templateStore.close();
  const path = join(f.directory, fileName), state = JSON.parse(await readFile(path, 'utf8'));
  const eventTemplate = state.events[0], jobTemplate = state.jobs[0];
  const time = (index, milliseconds = 0) => new Date(Date.UTC(2026, 9, 19, 0, 0, index, milliseconds)).toISOString();
  state.events = Array.from({length: events}, (_, index) => ({...structuredClone(eventTemplate), id: randomUUID(), created_at: time(index), finished_at: outcome === 'pending' ? null : time(index, 1), outcome}));
  state.events_total = events;
  state.recording_since = events ? state.events[0].created_at : state.recording_since;
  state.last_event_at = events ? state.events.at(-1).finished_at ?? state.events.at(-1).created_at : null;
  state.jobs = Array.from({length: jobs}, (_, index) => ({...structuredClone(jobTemplate), job_id: `job_${randomUUID()}`, session_id: `dsh_dot_${randomUUID()}`, message_id: randomUUID(), request_id: `synthetic-request-${index}`, created_at: time(index), finished_at: time(index, 1)})).toReversed();
  await writeFile(path, JSON.stringify(state), {mode: 0o600});
  const stat = await lstat(path); assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
  return {...f, seeded: state};
}

test('persists begin before returning and keeps only redacted approved metadata', async t => {
  const f = await fixture(t), store = await f.open(); t.after(() => store.close());
  const id = await begin(store, {request_id: 'request-1', selectors: {workspace_id: 'w1', path: `notes/password=${secret}`, offset: 0, max_bytes: 10}});
  let disk = JSON.parse(await readFile(join(f.directory, fileName), 'utf8'));
  assert.equal(disk.events[0].id, id); assert.equal(disk.events[0].outcome, 'pending');
  await store.finish(id, {outcome: 'succeeded', summary: {count: 1, source_bytes: 10, sha256_redacted: 'a'.repeat(64), source: `password=${secret}`, eof: true, next_offset: null}});
  disk = await readFile(join(f.directory, fileName), 'utf8');
  assert.equal(disk.includes(secret), false); assert.match(disk, /REDACTED/);
  const page = store.listEvents({limit: 1}); assert.equal(page.items[0].id, id); assert.equal(page.items[0].outcome, 'succeeded');
  assert.equal(page.total, 1); assert.equal(page.next_offset, null);
  const overview = store.overview(); assert.equal(overview.events_total, 1); assert.equal(overview.events_retained, 1); assert.equal(overview.paused, false); assert.equal(overview.retention_limit, 500);
  assert.match(overview.recording_since, /^\d{4}-/); assert.equal(overview.last_event_at, page.items[0].finished_at);
  assert.equal((await lstat(f.directory)).mode & 0o777, 0o700); assert.equal((await lstat(join(f.directory, fileName))).mode & 0o777, 0o600);
});

test('strict inputs reject arbitrary body/query data and unsafe IDs without recording it', async t => {
  const f = await fixture(t), store = await f.open(); t.after(() => store.close());
  for (const selectors of [{query: 'do not retain'}, {body: secret}, {workspace_id: secret}, {session_id: 's\n1'}, {offset: -1}, {limit: Number.MAX_SAFE_INTEGER + 1}, {path: 'x'.repeat(2001)}]) await assert.rejects(begin(store, {selectors}));
  await assert.rejects(begin(store, {task: secret}));
  await assert.rejects(begin(store, {category: 'body'}));
  await assert.rejects(begin(store, {request_id: secret}));
  const id = await begin(store);
  for (const summary of [{text: secret}, {body: secret}, {count: -1}, {sha256_redacted: secret}]) await assert.rejects(store.finish(id, {outcome: 'succeeded', summary}));
  await assert.rejects(store.finish(id, {outcome: 'succeeded', error_code: secret}));
  assert.equal(store.overview().events_total, 1); assert.equal(store.listEvents({}).items[0].outcome, 'pending');
  await assert.rejects(store.finish('missing', {outcome: 'failed'}));
});

test('serial changes survive reopen and interrupted pending events become unknown once', async t => {
  const f = await fixture(t); let store = await f.open();
  const ids = await Promise.all(Array.from({length: 8}, () => begin(store)));
  await store.finish(ids[0], {outcome: 'failed', error_code: 'SYNTHETIC_ERROR'}); await store.setPaused(true); await store.close();
  store = await f.open();
  assert.equal(store.overview().paused, true); assert.equal(store.overview().events_total, 8);
  assert.equal(store.listEvents({outcome: 'unknown'}).total, 7);
  assert.equal(store.listEvents({outcome: 'unknown'}).items[0].error_code, 'CONNECTOR_RESTARTED');
  assert.equal(store.listEvents({outcome: 'failed'}).items[0].error_code, 'SYNTHETIC_ERROR');
  const timestamp = store.listEvents({outcome: 'unknown'}).items[0].finished_at;
  await store.setPaused(false); await store.close(); store = await f.open(); t.after(() => store.close());
  assert.equal(store.overview().paused, false); assert.equal(store.listEvents({outcome: 'unknown'}).items[0].finished_at, timestamp);
});

test('pages events newest first and returns detached copies', async t => {
  const f = await fixture(t), store = await f.open(); t.after(() => store.close());
  const a = await begin(store), b = await begin(store, {category: 'task'}), c = await begin(store, {category: 'task'});
  await store.finish(a, {outcome: 'denied'}); await store.finish(b, {outcome: 'succeeded'});
  const page = store.listEvents({category: 'task', limit: 1}); assert.equal(page.total, 2); assert.equal(page.items[0].id, c); assert.equal(page.next_offset, 1);
  assert.equal(store.listEvents({category: 'task', offset: 1, limit: 1}).items[0].id, b);
  page.items[0].selectors.path = 'mutated'; assert.equal(store.listEvents({}).items[0].selectors.path, 'README.md');
  for (const input of [{offset: -1}, {limit: 501}, {category: 'bad'}, {outcome: 'bad'}, {unknown: true}]) assert.throws(() => store.listEvents(input));
});

test('retention prunes oldest terminal records while preserving pending and total-ever', async t => {
  const f = await seededFixture(t, {events: 499}), store = await f.open();
  const oldestTerminal = f.seeded.events[0].id, pending = await Promise.all(Array.from({length: 3}, () => begin(store)));
  const page = store.listEvents({limit: 500}); assert.equal(page.total, 500); assert.ok(pending.every(id => page.items.some(event => event.id === id && event.outcome === 'pending'))); assert.equal(page.items.some(event => event.id === oldestTerminal), false);
  assert.equal(store.overview().events_total, 502); assert.equal(store.overview().events_retained, 500);
  page.items[0].selectors.path = 'detached fixture'; assert.equal(store.listEvents({limit: 1}).items[0].selectors.path, 'README.md');
  await store.finish(pending[2], {outcome: 'succeeded'}); await store.close();
  const reopened = await f.open(); assert.equal(reopened.overview().events_total, 502); assert.equal(reopened.overview().events_retained, 500); assert.equal(reopened.listEvents({outcome: 'unknown'}).total, 2);
});

test('recovers 500 interrupted attempts without replay and rejects a 501-event persisted state', async t => {
  // A valid reopen MUST convert pending to unknown. It cannot seed 500 live
  // pending events without bypassing production recovery. The original live
  // AUDIT_CAPACITY branch passed real 500-write runs before this fixture-only
  // optimization; production remains unchanged. This bounded regression checks
  // full-ledger recovery/schema capacity, plus the mixed pending retention test.
  const f = await seededFixture(t, {events: 500, outcome: 'pending'}), store = await f.open();
  assert.equal(store.overview().events_total, 500); assert.equal(store.listEvents({outcome: 'unknown'}).total, 500); assert.equal(store.listEvents({outcome: 'pending'}).total, 0);
  assert.ok(store.listEvents({limit: 500}).items.every(event => event.error_code === 'CONNECTOR_RESTARTED'));
  const id = await begin(store); await store.finish(id, {outcome: 'succeeded'}); assert.equal(store.overview().events_total, 501); assert.equal(store.overview().events_retained, 500);
  await store.close();
  const path = join(f.directory, fileName), valid = JSON.parse(await readFile(path, 'utf8'));
  const oversized = {...valid, events_total: 502, events: [...valid.events, {...structuredClone(valid.events[0]), id: randomUUID()}]};
  await writeFile(path, JSON.stringify(oversized), {mode: 0o600});
  await assert.rejects(f.open(), error => error.code === 'AUDIT_UNAVAILABLE');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), oversized);
  await assert.rejects(readFile(join(f.directory, 'connector-manager.lock')));
});

test('imports only fixed-principal connector-owned public job fields and redacts detail', async t => {
  const f = await fixture(t), store = await f.open(); t.after(() => store.close());
  const row = ownedJob({context_sources: [{path: `password=${secret}`, sha256: 'a'.repeat(64)}], internal: secret});
  const result = await store.importJobs([row, ownedJob({principal: 'foreign'}), ownedJob({principal: undefined}), ownedJob({job_id: 'other-job'}), ownedJob({session_id: 'foreign-session'}), ownedJob({project_id: secret}), ownedJob({status: 'broken'})]);
  assert.deepEqual(result, {imported: 1, skipped: 6});
  const detail = store.job(row.job_id); assert.equal(detail.acceptance, 'unverified'); assert.equal(detail.principal, undefined); assert.equal(detail.fingerprint, undefined); assert.equal(detail.internal, undefined);
  assert.equal(JSON.stringify(detail).includes(secret), false); assert.match(detail.task, /REDACTED/); assert.match(detail.result, /REDACTED/);
  detail.context_sources[0].path = 'changed'; assert.notEqual(store.job(row.job_id).context_sources[0].path, 'changed');
  assert.throws(() => store.job('unknown-job'), error => error.code === 'AUDIT_DENIED');
  assert.equal(store.overview().jobs_total, 1);
});

test('observed owned responses update jobs, reject foreign identity and cap at 100', async t => {
  const f = await seededFixture(t, {jobs: 99}), store = await f.open();
  assert.equal(store.listJobs({limit: 100}).total, 99);
  const rows = [99, 100].map(i => ownedJob({created_at: new Date(Date.UTC(2026, 9, 19, 0, 0, i)).toISOString(), finished_at: new Date(Date.UTC(2026, 9, 19, 0, 0, i, 1)).toISOString()}));
  assert.deepEqual(await store.importJobs(rows), {imported: 2, skipped: 0}); assert.equal(store.listJobs({limit: 100}).total, 100); assert.equal(store.listJobs({limit: 1}).items[0].job_id, rows[1].job_id); assert.throws(() => store.job(f.seeded.jobs.at(-1).job_id));
  const publicJob = ownedJob({status: 'cancel_requested', result: null, finished_at: null, created_at: '2026-10-19T00:02:00.000Z'}); delete publicJob.principal;
  const event = await begin(store, {category: 'task', job_id: publicJob.job_id});
  await store.finish(event, {outcome: 'succeeded', job: publicJob, summary: {job_id: publicJob.job_id, status: publicJob.status}});
  assert.equal(store.job(publicJob.job_id).status, 'cancel_requested');
  const detail = store.job(publicJob.job_id); detail.status = 'cancelled'; assert.equal(store.job(publicJob.job_id).status, 'cancel_requested');
  const bad = await begin(store); await assert.rejects(store.finish(bad, {outcome: 'succeeded', job: ownedJob({principal: 'foreign'})}));
  assert.equal(store.listEvents({outcome: 'pending'}).items[0].id, bad);
  await store.close(); const reopened = await f.open(); assert.equal(reopened.overview().jobs_total, 100); assert.equal(reopened.job(publicJob.job_id).status, 'cancel_requested');
});

test('exclusive manager lock blocks another owner and close never deletes a replacement lock', async t => {
  const f = await fixture(t), store = await f.open();
  await assert.rejects(f.open(), error => error.code === 'AUDIT_LOCKED');
  const lock = join(f.directory, 'connector-manager.lock');
  await rename(lock, join(f.directory, 'owned-old-lock')); await writeFile(lock, 'synthetic foreign lock', {mode: 0o600});
  await assert.rejects(store.close()); assert.equal(await readFile(lock, 'utf8'), 'synthetic foreign lock');
  await assert.rejects(begin(store)); assert.throws(() => store.overview());
});

test('rejects symlink paths, public directories, hardlinked or nonprivate state and unknown locks', async t => {
  const f = await fixture(t); await mkdir(f.directory, {mode: 0o700});
  const alias = join(f.home, 'alias'); await symlink(f.directory, alias);
  await assert.rejects(implementation.createAuditStore({directory: join(alias, 'new'), principal}));
  await assert.rejects(readFile(join(f.directory, 'new', fileName)));
  await chmod(f.directory, 0o755); await assert.rejects(f.open()); await chmod(f.directory, 0o700);
  const state = join(f.directory, fileName), target = join(f.home, 'target'); await writeFile(target, '{}', {mode: 0o600});
  await symlink(target, state); await assert.rejects(f.open()); await unlink(state);
  await link(target, state); await assert.rejects(f.open()); await unlink(state);
  await writeFile(state, '{}', {mode: 0o644}); await assert.rejects(f.open()); await unlink(state);
  await writeFile(join(f.directory, 'connector-manager.lock'), 'foreign', {mode: 0o600}); await assert.rejects(f.open(), error => error.code === 'AUDIT_LOCKED');
  assert.equal(await readFile(join(f.directory, 'connector-manager.lock'), 'utf8'), 'foreign');
});

test('rejects malformed, foreign-principal and oversized disk state without exposing contents', async t => {
  const f = await fixture(t); let store = await f.open(); await begin(store); await store.close();
  const path = join(f.directory, fileName), valid = JSON.parse(await readFile(path, 'utf8'));
  for (const contents of [JSON.stringify({...valid, principal: 'foreign'}), JSON.stringify({...valid, raw_body: secret}), '{bad json', ' '.repeat(16 * 1024 * 1024 + 1)]) {
    await writeFile(path, contents, {mode: 0o600});
    await assert.rejects(f.open(), error => error.code === 'AUDIT_UNAVAILABLE' && !error.message.includes(secret));
    await assert.rejects(readFile(join(f.directory, 'connector-manager.lock')));
  }
});

test('unsafe state replacement makes mutations fail closed without reporting success', async t => {
  const f = await fixture(t), store = await f.open(); t.after(() => store.close());
  const id = await begin(store), file = join(f.directory, fileName), target = join(f.home, 'other');
  await writeFile(target, 'unchanged', {mode: 0o600}); await unlink(file); await symlink(target, file);
  await assert.rejects(store.finish(id, {outcome: 'succeeded'}), error => error.code === 'AUDIT_UNAVAILABLE');
  await assert.rejects(store.setPaused(true)); await assert.rejects(begin(store));
  assert.throws(() => store.overview(), error => error.code === 'AUDIT_UNAVAILABLE');
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
});

test('close drains pending serialized writes and all subsequent methods reject', async t => {
  const f = await fixture(t), store = await f.open();
  const pending = begin(store); const closing = store.close(); const id = await pending; await closing;
  for (const run of [() => begin(store), () => store.finish(id, {outcome: 'failed'}), () => store.setPaused(true), () => store.importJobs([])]) await assert.rejects(run());
  for (const run of [() => store.overview(), () => store.listEvents({}), () => store.listJobs({}), () => store.job('missing')]) assert.throws(run);
  await store.close();
  const reopened = await f.open(); t.after(() => reopened.close()); assert.equal(reopened.overview().events_total, 1);
});

test('operation names cannot carry secret-bearing strings into metadata', async t => {
  const f = await fixture(t), store = await f.open();
  await assert.rejects(begin(store, {tool: 'ghp_abcdefghijklmnopqrstuv'}), error => error.code === 'AUDIT_DENIED');
  assert.equal(store.overview().events_total, 0);
});

test('stale imports and late accepted receipts cannot downgrade an observed terminal job', async t => {
  const f = await fixture(t), store = await f.open();
  const running = ownedJob({status: 'running', turn: 1, result: null, result_truncated: false, finished_at: null});
  await store.importJobs([running]);
  const latest = {...running, status: 'succeeded', result: 'latest confirmed result', finished_at: '2026-10-19T00:00:03.000Z'}; delete latest.principal; delete latest.task; delete latest.request_id;
  const observation = await begin(store, {category: 'task', job_id: running.job_id});
  await store.finish(observation, {outcome: 'succeeded', job: latest});
  await store.importJobs([{...running, task: 'stale replacement task', request_id: 'stale-request'}]);
  let detail = store.job(running.job_id); assert.equal(detail.status, 'succeeded'); assert.equal(detail.result, 'latest confirmed result'); assert.equal(detail.task.includes('stale'), false); assert.equal(detail.request_id, running.request_id);
  const lateReceipt = await begin(store, {category: 'task', job_id: running.job_id});
  await store.finish(lateReceipt, {outcome: 'succeeded', job: {...latest, status: 'accepted', turn: null, result: null, finished_at: null, duplicate: true}});
  detail = store.job(running.job_id); assert.equal(detail.status, 'succeeded'); assert.equal(detail.turn, 1); assert.equal(detail.result, 'latest confirmed result');
  await store.close(); const reopened = await f.open(); assert.equal(reopened.job(running.job_id).status, 'succeeded'); assert.equal(reopened.job(running.job_id).result, 'latest confirmed result');
});

test('live snapshots preserve cancellation and turn progress while filling missing metadata', async t => {
  const f = await fixture(t), store = await f.open();
  const initial = ownedJob({status: 'cancel_requested', turn: null, result: null, finished_at: null}); delete initial.task; delete initial.request_id;
  const observed = {...initial}; delete observed.principal;
  const event = await begin(store, {category: 'task'}); await store.finish(event, {outcome: 'succeeded', job: observed});
  await store.importJobs([{...initial, status: 'running', turn: 2, task: 'first known task', request_id: 'first-known-request'}]);
  assert.equal(store.job(initial.job_id).status, 'cancel_requested'); assert.equal(store.job(initial.job_id).turn, 2); assert.equal(store.job(initial.job_id).task, 'first known task');
  await store.importJobs([{...initial, status: 'running', turn: 1, task: 'older task', request_id: 'older-request'}]);
  const stale = await begin(store, {category: 'task'}); await store.finish(stale, {outcome: 'succeeded', job: {...observed, status: 'accepted', turn: null, duplicate: true}});
  const detail = store.job(initial.job_id); assert.equal(detail.status, 'cancel_requested'); assert.equal(detail.turn, 2); assert.equal(detail.task, 'first known task'); assert.equal(detail.request_id, 'first-known-request');
});

test('terminal conflicts require newer finish evidence and never overwrite known identity or result with stale data', async t => {
  const f = await fixture(t), store = await f.open();
  const original = ownedJob({turn: 2, result: 'confirmed original', finished_at: '2026-10-19T00:00:05.000Z'});
  await store.importJobs([original]);
  for (const row of [
    {...original, status: 'cancelled', result: null, finished_at: '2026-10-19T00:00:04.000Z'},
    {...original, status: 'cancelled', result: null},
    {...original, status: 'cancelled', result: null, turn: 1, finished_at: '2026-10-19T00:00:06.000Z'},
  ]) await store.importJobs([row]);
  assert.equal(store.job(original.job_id).status, 'succeeded'); assert.equal(store.job(original.job_id).result, 'confirmed original');
  const update = await begin(store, {category: 'task'});
  await store.finish(update, {outcome: 'succeeded', job: {...original, status: 'cancelled', result: null, finished_at: '2026-10-19T00:00:06.000Z'}});
  assert.equal(store.job(original.job_id).status, 'cancelled'); assert.equal(store.job(original.job_id).finished_at, '2026-10-19T00:00:06.000Z');
  const stale = await begin(store, {category: 'task'}); await store.finish(stale, {outcome: 'succeeded', job: original}); assert.equal(store.job(original.job_id).status, 'cancelled');
  const invalid = await store.importJobs([{...original, finished_at: null}, {...original, result: null}, {...original, session_id: `dsh_dot_${randomUUID()}`}, {...original, message_id: randomUUID()}, {...original, project_id: 'other'}, {...original, created_at: '2026-10-19T01:00:00.000Z'}]);
  assert.deepEqual(invalid, {imported: 0, skipped: 6});
  const collision = await begin(store, {category: 'task'}); await assert.rejects(store.finish(collision, {outcome: 'succeeded', job: {...original, message_id: randomUUID()}}), error => error.code === 'AUDIT_DENIED');
  assert.equal(store.job(original.job_id).status, 'cancelled');
});

test('definite completion resolves unknown despite an earlier finish timestamp but unknown cannot replace completion', async t => {
  const f = await fixture(t), store = await f.open();
  const uncertain = ownedJob({status: 'unknown', turn: 2, result: null, finished_at: '2026-10-19T00:00:10.000Z'});
  await store.importJobs([uncertain]);
  await store.importJobs([{...uncertain, status: 'running', finished_at: null}]); assert.equal(store.job(uncertain.job_id).status, 'unknown');
  const resolved = {...uncertain, status: 'succeeded', result: 'late definite completion', finished_at: '2026-10-19T00:00:05.000Z'};
  const event = await begin(store, {category: 'task'}); await store.finish(event, {outcome: 'succeeded', job: resolved});
  assert.equal(store.job(uncertain.job_id).status, 'succeeded'); assert.equal(store.job(uncertain.job_id).result, 'late definite completion');
  await store.importJobs([uncertain]); assert.equal(store.job(uncertain.job_id).status, 'succeeded'); assert.equal(store.job(uncertain.job_id).result, 'late definite completion');
});
