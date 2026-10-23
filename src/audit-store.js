import {constants} from 'node:fs';
import {lstat, mkdir, open, realpath, rename, unlink} from 'node:fs/promises';
import {isAbsolute, join, parse, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {redactText} from './harness-reader.js';

const EVENT_LIMIT = 500;
const JOB_LIMIT = 100;
const FILE_LIMIT = 16 * 1024 * 1024;
const uid = process.getuid?.();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const knownId = z.string().min(1).max(2000).refine(value => !/[\x00-\x1f\x7f]/.test(value) && redactText(value).redaction_count === 0);
const jobId = knownId.refine(value => value.startsWith('job_') && uuidPattern.test(value.slice(4)) || value.startsWith('native_job_') && uuidPattern.test(value.slice(11)));
const sessionId = knownId.refine(value => value.startsWith('dsh_dot_') && uuidPattern.test(value.slice(8)));
const stamp = z.string().datetime();
const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/).refine(value => redactText(value).redaction_count === 0);
const humanText = (max = 2000) => z.string().max(max).transform(value => Array.from(redactText(value).text).slice(0, max).join(''));
const categories = z.enum(['read', 'task', 'control']);
const outcomes = z.enum(['pending', 'succeeded', 'failed', 'unknown', 'denied']);
const liveStages = {accepted: 0, starting: 1, running: 2, cancel_requested: 3};
const definiteStatuses = new Set(['succeeded', 'failed', 'cancelled']);
const jobStatuses = z.enum(['accepted', 'starting', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'unknown']);
const selectorsSchema = z.object({
  project_id: knownId.optional(), workspace_id: knownId.optional(), session_id: knownId.optional(), job_id: knownId.optional(),
  path: humanText().optional(), offset: integer.optional(), limit: integer.optional(), max_bytes: integer.optional(),
}).strict();
const summarySchema = z.object({
  count: integer.optional(), total: integer.optional(), source_bytes: integer.optional(),
  sha256_redacted: z.string().regex(/^[a-f0-9]{64}$/).optional(), source: humanText().optional(), eof: z.boolean().optional(),
  has_more: z.boolean().optional(), next_offset: integer.nullable().optional(), job_id: jobId.optional(),
  status: humanText(100).optional(), result_truncated: z.boolean().optional(),
}).strict();
const beginSchema = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).refine(value => redactText(value).redaction_count === 0), category: categories, selectors: selectorsSchema,
  request_id: knownId.optional(), job_id: jobId.optional(),
}).strict();
// Projection deliberately discards raw core principal, task fingerprints, model
// configuration and every field outside the documented public job shape.
const jobSchema = z.object({
  job_id: jobId, project_id: knownId, status: jobStatuses, session_id: sessionId,
  message_id: z.string().regex(uuidPattern), turn: integer.nullable(), result: humanText(16000).nullable(),
  result_truncated: z.boolean(), reason: humanText(100).nullable(), created_at: stamp, finished_at: stamp.nullable(),
  context_sources: z.array(z.object({path: humanText(300), sha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(6),
  acceptance: z.literal('unverified').default('unverified'), duplicate: z.boolean().optional(),
  task: humanText(2000).optional(), request_id: knownId.optional(),
}).strict().refine(job => (Object.hasOwn(liveStages, job.status) ? job.finished_at === null : job.finished_at !== null)
  && (job.status !== 'succeeded' || (typeof job.result === 'string' && job.result.trim().length > 0)));
const eventSchema = beginSchema.extend({
  id: z.string().regex(uuidPattern), created_at: stamp, finished_at: stamp.nullable(), outcome: outcomes,
  error_code: code.optional(), summary: summarySchema.optional(),
}).strict().refine(event => (event.outcome === 'pending') === (event.finished_at === null));
const stateSchema = z.object({
  version: z.literal(1), principal: knownId, paused: z.boolean(), recording_since: stamp,
  events_total: integer, last_event_at: stamp.nullable(), events: z.array(eventSchema).max(EVENT_LIMIT),
  jobs: z.array(jobSchema).max(JOB_LIMIT),
}).strict().refine(state => state.events_total >= state.events.length
  && new Set(state.events.map(event => event.id)).size === state.events.length
  && new Set(state.jobs.map(job => job.job_id)).size === state.jobs.length);
const eventPageSchema = z.object({offset: integer.optional(), limit: integer.min(1).max(EVENT_LIMIT).optional(), category: categories.optional(), outcome: outcomes.optional()}).strict();
const jobPageSchema = z.object({offset: integer.optional(), limit: integer.min(1).max(JOB_LIMIT).optional(), status: jobStatuses.optional()}).strict();
const finishSchema = z.object({outcome: outcomes.exclude(['pending']), error_code: code.optional(), summary: summarySchema.optional(), job: z.unknown().optional()}).strict();
const fail = (code = 'AUDIT_UNAVAILABLE') => Object.assign(new Error({
  AUDIT_UNAVAILABLE: 'Connector audit storage unavailable.', AUDIT_DENIED: 'Connector audit access denied.',
  AUDIT_LOCKED: 'Connector manager state locked; inspect owner before recovery.', AUDIT_CAPACITY: 'Connector audit pending capacity reached.',
}[code]), {code});
const validate = (schema, value) => {const parsed = schema.safeParse(value); if (!parsed.success) throw fail('AUDIT_DENIED'); return parsed.data;};
const ordinary = stat => stat.isFile() && stat.nlink === 1 && (uid === undefined || stat.uid === uid) && (stat.mode & 0o777) === 0o600 && stat.size <= FILE_LIMIT;
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const copy = value => structuredClone(value);

function projectJob(value, principal, requirePrincipal = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (requirePrincipal ? value.principal !== principal : value.principal !== undefined && value.principal !== principal)) throw fail('AUDIT_DENIED');
  const selected = {};
  for (const key of Object.keys(jobSchema.shape)) if (Object.hasOwn(value, key)) selected[key] = value[key];
  const result = validate(jobSchema, selected);
  if (result.status !== 'succeeded') {result.result = null; result.result_truncated = false;}
  return result;
}

/** Snapshots can arrive out of order from an observed response and a read-only
 * import. Keep correlation fixed and merge evidence monotonically. A local
 * unknown is uncertainty: explicit completion can resolve it even if its actual
 * finish predates the time at which the connector noticed the uncertainty.
 */
function mergeJob(prior, incoming) {
  if (['project_id', 'session_id', 'message_id', 'created_at'].some(key => prior[key] !== incoming[key])) throw fail('AUDIT_DENIED');
  const turnAdvances = prior.turn === null || (incoming.turn !== null && incoming.turn >= prior.turn);
  const newerFinish = incoming.finished_at !== null && prior.finished_at !== null
    && Date.parse(incoming.finished_at) > Date.parse(prior.finished_at);
  const incomingDefinite = definiteStatuses.has(incoming.status);
  let selected = prior;
  if (definiteStatuses.has(prior.status)) {
    if (incomingDefinite && turnAdvances && newerFinish) selected = incoming;
  } else if (prior.status === 'unknown') {
    if (turnAdvances && (incomingDefinite || (incoming.status === 'unknown' && newerFinish))) selected = incoming;
  } else if (incomingDefinite || incoming.status === 'unknown') {
    if (turnAdvances) selected = incoming;
  } else if (!(prior.turn !== null && incoming.turn !== null && incoming.turn < prior.turn)) {
    selected = {...incoming,
      status: liveStages[prior.status] > liveStages[incoming.status] ? prior.status : incoming.status,
      turn: incoming.turn === null ? prior.turn : Math.max(prior.turn ?? 0, incoming.turn),
    };
  }
  const result = {...selected};
  for (const key of ['task', 'request_id']) {
    if (prior[key] !== undefined) result[key] = prior[key];
    else if (incoming[key] !== undefined) result[key] = incoming[key];
  }
  result.context_sources = prior.context_sources.length ? prior.context_sources : incoming.context_sources;
  return result;
}

/** Only canonical, ordinary directory ancestors may be traversed. Root-owned
 * sticky temporary ancestors are allowed; other publicly writable parents are
 * not. Check before mkdir, so a rejected symlink cannot create child paths.
 */
async function prepareDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0') || resolve(directory) !== directory) throw fail();
  const root = parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, part);
    let stat;
    try {stat = await lstat(current);} catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current, {mode: 0o700}); stat = await lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid && stat.uid !== 0)
        || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))) throw fail();
  }
  const stat = await lstat(directory);
  if ((stat.mode & 0o777) !== 0o700 || (uid !== undefined && stat.uid !== uid) || await realpath(directory) !== directory) throw fail();
  return stat;
}

function page(items, {offset = 0, limit = 50}) {
  const end = offset + limit;
  return copy({items: items.slice(offset, end), total: items.length, offset, next_offset: end < items.length ? end : null, has_more: end < items.length});
}

/** Durable metadata-only ledger for one fixed owner connector channel.
 * importJobs skips foreign/malformed rows and reports their count. It does not
 * discover jobs or read any other state file. Only an authenticated owner gateway
 * may supply an observed public job via finish(). No event is ever replayed.
 */
export async function createAuditStore({directory, principal} = {}) {
  validate(knownId, principal);
  let directoryStat, directoryHandle, lock, lockStat;
  const lockPath = typeof directory === 'string' ? join(directory, 'connector-manager.lock') : '';
  const file = typeof directory === 'string' ? join(directory, 'connector-manager-state.json') : '';
  let state, queue = Promise.resolve(), closing = false, closed = false, storageFailed = false, closePromise;

  const assertAvailable = () => {if (closing || closed || storageFailed) throw fail();};
  const assertDiskIdentity = async () => {
    const observed = await lstat(directory);
    if (!observed.isDirectory() || !same(observed, directoryStat) || (observed.mode & 0o777) !== 0o700
        || (uid !== undefined && observed.uid !== uid) || await realpath(directory) !== directory) throw fail();
    const lockObserved = await lstat(lockPath);
    if (!ordinary(lockObserved) || !same(lockObserved, lockStat)) throw fail();
  };
  const checkStateFile = async () => {
    try {const stat = await lstat(file); if (!ordinary(stat)) throw fail(); return stat;} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
  };
  const releaseLock = async () => {
    try {
      if (lock) {
        const observed = await lstat(lockPath);
        if (!ordinary(observed) || !same(observed, lockStat) || !same(await lstat(directory), directoryStat)) throw fail();
        await unlink(lockPath);
      }
    } finally {await lock?.close(); lock = null; await directoryHandle?.close(); directoryHandle = null;}
  };
  const save = async next => {
    let temporary, handle, temporaryStat;
    try {
      const validated = stateSchema.parse(next);
      const bytes = JSON.stringify(validated);
      if (Buffer.byteLength(bytes) > FILE_LIMIT) throw fail();
      await assertDiskIdentity(); await checkStateFile();
      temporary = join(directory, `.connector-manager-${randomUUID()}.tmp`);
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      temporaryStat = await handle.stat(); if (!ordinary(temporaryStat)) throw fail();
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await assertDiskIdentity(); await checkStateFile();
      const observed = await lstat(temporary); if (!ordinary(observed) || !same(observed, temporaryStat)) throw fail();
      await rename(temporary, file); temporary = null;
      await directoryHandle.sync();
      state = validated;
    } catch {storageFailed = true; throw fail();}
    finally {
      await handle?.close().catch(() => {});
      // Delete only the random ordinary tempfile this instance actually created.
      if (temporary && temporaryStat) {
        try {const stat = await lstat(temporary); if (ordinary(stat) && same(stat, temporaryStat)) await unlink(temporary);} catch {}
      }
    }
  };

  try {
    directoryStat = await prepareDirectory(directory);
    directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!same(await directoryHandle.stat(), directoryStat)) throw fail();
    try {lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);} catch {throw fail('AUDIT_LOCKED');}
    lockStat = await lock.stat(); if (!ordinary(lockStat)) throw fail();
    await lock.writeFile(JSON.stringify({pid: process.pid, instance_id: randomUUID(), created_at: new Date().toISOString()})); await lock.sync();
    await assertDiskIdentity();
    const existing = await checkStateFile();
    if (existing) {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat(); if (!ordinary(stat) || !same(existing, stat)) throw fail();
        const buffer = Buffer.alloc(Math.min(stat.size + 1, FILE_LIMIT + 1));
        let length = 0;
        while (length < buffer.length) {const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead;}
        const after = await handle.stat();
        if (length !== stat.size || !ordinary(after) || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || !same(await lstat(file), stat)) throw fail();
        state = stateSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
        if (state.principal !== principal) throw fail();
      } finally {await handle.close();}
      const next = copy(state); let dirty = false;
      for (const event of next.events) if (event.outcome === 'pending') {
        event.outcome = 'unknown'; event.error_code = 'CONNECTOR_RESTARTED'; event.finished_at = new Date().toISOString(); next.last_event_at = event.finished_at; dirty = true;
      }
      if (dirty) await save(next);
    } else await save({version: 1, principal, paused: false, recording_since: new Date().toISOString(), events_total: 0, last_event_at: null, events: [], jobs: []});
  } catch (error) {
    try {await releaseLock();} catch {}
    throw error?.code === 'AUDIT_LOCKED' ? error : fail();
  }

  // Admission is checked at enqueue time. close() drains already accepted writes
  // before releasing its lock, while refusing all newly submitted operations.
  const serial = fn => {
    try {assertAvailable();} catch (error) {return Promise.reject(error);}
    const result = queue.then(() => {if (storageFailed || closed) throw fail(); return fn();});
    queue = result.catch(() => {}); return result;
  };
  const upsertJob = (next, job) => {
    const prior = next.jobs.find(item => item.job_id === job.job_id);
    if (prior) Object.assign(prior, mergeJob(prior, job));
    else next.jobs.push(job);
    next.jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (next.jobs.length > JOB_LIMIT) next.jobs.length = JOB_LIMIT;
  };

  return {
    begin(input) {return serial(async () => {
      const args = validate(beginSchema, input), next = copy(state);
      if (next.events_total === Number.MAX_SAFE_INTEGER) throw fail('AUDIT_CAPACITY');
      if (next.events.length === EVENT_LIMIT) {
        const oldestTerminal = next.events.findIndex(event => event.outcome !== 'pending');
        if (oldestTerminal < 0) throw fail('AUDIT_CAPACITY');
        next.events.splice(oldestTerminal, 1);
      }
      const id = randomUUID(), created_at = new Date().toISOString();
      next.events.push({...args, id, created_at, finished_at: null, outcome: 'pending'});
      next.events_total++; next.last_event_at = created_at;
      await save(next); return id;
    });},
    finish(id, input) {return serial(async () => {
      validate(z.string().regex(uuidPattern), id);
      const args = validate(finishSchema, input), next = copy(state), event = next.events.find(item => item.id === id);
      if (!event || event.outcome !== 'pending') throw fail('AUDIT_DENIED');
      if (args.job !== undefined) upsertJob(next, projectJob(args.job, principal));
      const finished_at = new Date().toISOString();
      Object.assign(event, {outcome: args.outcome, finished_at}, args.error_code === undefined ? {} : {error_code: args.error_code}, args.summary === undefined ? {} : {summary: args.summary});
      next.last_event_at = finished_at; await save(next);
    });},
    setPaused(paused) {return serial(async () => {validate(z.boolean(), paused); const next = copy(state); next.paused = paused; await save(next); return {paused};});},
    overview() {assertAvailable(); return copy({paused: state.paused, recording_since: state.recording_since, events_total: state.events_total, events_retained: state.events.length, jobs_total: state.jobs.length, retention_limit: EVENT_LIMIT, last_event_at: state.last_event_at});},
    listEvents(input = {}) {assertAvailable(); const args = validate(eventPageSchema, input); return page(state.events.toReversed().filter(event => (args.category === undefined || event.category === args.category) && (args.outcome === undefined || event.outcome === args.outcome)), args);},
    listJobs(input = {}) {assertAvailable(); const args = validate(jobPageSchema, input); return page(state.jobs.filter(job => args.status === undefined || job.status === args.status), args);},
    job(id) {assertAvailable(); validate(jobId, id); const found = state.jobs.find(job => job.job_id === id); if (!found) throw fail('AUDIT_DENIED'); return copy(found);},
    importJobs(rows) {return serial(async () => {
      if (!Array.isArray(rows) || rows.length > 10000) throw fail('AUDIT_DENIED');
      const next = copy(state); let imported = 0, skipped = 0;
      for (const row of rows) {try {upsertJob(next, projectJob(row, principal, true)); imported++;} catch {skipped++;}}
      if (imported) await save(next);
      return {imported, skipped};
    });},
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {await queue; closed = true; try {await releaseLock();} catch {throw fail();}})();
      return closePromise;
    },
  };
}
