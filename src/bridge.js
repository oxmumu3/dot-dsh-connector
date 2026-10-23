import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

export const HARNESS_TOOL_NAMES = Object.freeze([
  'harness_status', 'harness_list_workspaces', 'harness_list_sessions',
  'harness_read_session', 'harness_list_directory', 'harness_read_file',
]);
export const NATIVE_TASK_TOOL_NAMES=Object.freeze(['harness_start_task','harness_get_task','harness_followup_task','harness_cancel_task','harness_list_tasks','harness_archive_task']);
const TOOLS = new Set(['list_projects', 'read_project_context', 'start_task', 'get_task', 'cancel_task', ...HARNESS_TOOL_NAMES,...NATIVE_TASK_TOOL_NAMES]);
const MANAGEMENT_TOOLS = new Set(['manager_overview','manager_events','manager_jobs','manager_job','manager_set_paused','manager_cancel','manager_worker_poll','manager_archive','manager_followup']);
const PUBLIC_ERRORS = Object.freeze({
  BACKEND_OFFLINE: { status: 503, message: 'DSH backend is offline or unavailable.' },
  BACKEND_REJECTED: { status: 400, message: 'DSH backend rejected the operation.' },
  HARNESS_DENIED: { status: 403, message: 'Harness read access denied.' },
  HARNESS_UNAVAILABLE: { status: 503, message: 'Harness persisted read service is unavailable.' },
  HARNESS_RESPONSE_LIMIT: { status: 413, message: 'Harness read response exceeds the bounded page limit. Use a smaller page.' },
  REQUEST_TIMEOUT: { status: 504, message: 'Connector request timed out; task acceptance is unknown. Do not retry with a new request_id.' },
  INTERNAL_ERROR: { status: 500, message: 'Connector operation failed.' },
  CONNECTOR_PAUSED: { status: 503, message: 'Connector is paused. Existing task status and cancellation remain available.' },
  AUDIT_UNAVAILABLE: { status: 503, message: 'Connector audit is unavailable. Operation outcome may be unknown.' },
  MANAGEMENT_DENIED: { status: 403, message: 'Management access denied.' },
  MANAGEMENT_BUSY: { status: 429, message: 'Management service is busy. Retry this read shortly.' },
  NATIVE_DENIED: {status:403,message:'Native Harness task access denied.'},
  NATIVE_INVALID: {status:400,message:'Invalid native Harness task request.'},
  NATIVE_CONFLICT: {status:409,message:'Native task request conflicts with existing work. Query the known job before retrying.'},
  NATIVE_UNAVAILABLE: {status:503,message:'Native Harness task transport is unavailable. Outcome may be unknown; do not create a new request_id.'},
  NATIVE_CAPACITY: {status:503,message:'Native Harness task capacity reached.'},
});
const CORE_REJECTIONS = new Set([
  'Job access denied', 'Project access denied', 'Unknown tool', 'request_id conflict',
  'Connector not accepting requests', 'Job capacity reached', 'Project root symlink denied',
  'Context path denied', 'Context symlink denied', 'Context must be an ordinary single-link file',
  'Context exceeds byte limit', 'Context changed during read', 'Binary context denied',
]);

export function isValidToken(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 512 && /^[A-Za-z0-9._~+/=-]+$/.test(token);
}

export function publicError(error) {
  const code = Object.hasOwn(PUBLIC_ERRORS, error?.code) ? error.code
    : (error?.name === 'ZodError' || CORE_REJECTIONS.has(error?.message)) ? 'BACKEND_REJECTED' : 'INTERNAL_ERROR';
  return { code, message: PUBLIC_ERRORS[code].message };
}

function failure(code) {
  return Object.assign(new Error(PUBLIC_ERRORS[code].message), { code });
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function send(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  let body;
  try {
    body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('response limit');
  } catch {
    status = 500;
    body = JSON.stringify({ error: publicError(null) });
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close',
  });
  res.end(body);
}

function reject(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, rejectBody) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
    };
    const onError = () => { cleanup(); rejectBody(Object.assign(new Error('invalid body'), { status: 400 })); };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        cleanup();
        req.resume();
        rejectBody(Object.assign(new Error('body limit'), { status: 413 }));
      } else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
  });
}

function validEnvelope(value, tools) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.hasOwn(value, 'tool') && Object.hasOwn(value, 'args')
    && typeof value.tool === 'string' && tools.has(value.tool)
    && value.args !== null && typeof value.args === 'object' && !Array.isArray(value.args);
}

/** Authenticated local transport. The configured principal is the only identity authority. */
export async function createBridge(options) {
  const { service, token, principal, port = 0, maxBodyBytes = 64 * 1024, requestTimeoutMs = 10_000, scope = 'connector' } = options ?? {};
  const allowedOptions = new Set(['service', 'token', 'principal', 'port', 'maxBodyBytes', 'requestTimeoutMs', 'scope']);
  if (!options || Object.keys(options).some((key) => !allowedOptions.has(key))
      || typeof service?.call !== 'function' || !isValidToken(token)
      || typeof principal !== 'string' || !principal.trim() || principal.length > 256
      || !Number.isInteger(port) || port < 0 || port > 65535
      || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 64 || maxBodyBytes > 1024 * 1024
      || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000
      || !['connector','management'].includes(scope)) {
    throw new Error('Invalid connector configuration.');
  }
  const expectedAuth = digest(`Bearer ${token}`);
  const tools = scope === 'management' ? MANAGEMENT_TOOLS : TOOLS;
  let expectedHost;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    try {
      if (req.headers.host !== expectedHost) return reject(res, 403, 'FORBIDDEN', 'Request origin is not allowed.');
      const sensitiveCounts = new Map();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i].toLowerCase();
        if (['host', 'authorization', 'origin'].includes(key)) sensitiveCounts.set(key, (sensitiveCounts.get(key) ?? 0) + 1);
      }
      if ([...sensitiveCounts.values()].some((count) => count > 1)
          || req.headers.origin !== undefined
          || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'none')) {
        return reject(res, 403, 'FORBIDDEN', 'Request origin is not allowed.');
      }
      const auth = req.headers.authorization;
      if (typeof auth !== 'string' || !timingSafeEqual(expectedAuth, digest(auth))) {
        return reject(res, 401, 'UNAUTHORIZED', 'Connector authentication required.');
      }
      if (req.url !== '/rpc') return reject(res, 404, 'NOT_FOUND', 'Route not found.');
      if (req.method !== 'POST') return reject(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
        return reject(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type required.');
      }
      if (Number(req.headers['content-length']) > maxBodyBytes) return reject(res, 413, 'BODY_TOO_LARGE', 'Request body exceeds limit.');
      let timer;
      try {
        const work = async () => {
          let value;
          try {
            value = JSON.parse(await readBody(req, maxBodyBytes));
          } catch (error) {
            const status = error?.status === 413 ? 413 : 400;
            return { status, payload: { error: { code: status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST', message: 'Invalid or oversized JSON request.' } } };
          }
          if (!validEnvelope(value, tools)) return { status: 400, payload: { error: { code: 'INVALID_REQUEST', message: 'Invalid RPC request.' } } };
          const result = await service.call(principal, value.tool, value.args);
          return { status: 200, payload: { result } };
        };
        const timeout = new Promise((_, rejectTimeout) => {
          timer = setTimeout(() => rejectTimeout(failure('REQUEST_TIMEOUT')), requestTimeoutMs);
        });
        const response = await Promise.race([work(), timeout]);
        send(res, response.status, response.payload);
      } catch (error) {
        const safe = publicError(error);
        send(res, PUBLIC_ERRORS[safe.code].status, { error: safe });
      } finally {
        clearTimeout(timer);
        req.resume();
      }
    } catch {
      send(res, 500, { error: publicError(null) });
    }
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 10_000);
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 1;
  await new Promise((resolve, rejectListen) => {
    const failed = () => rejectListen(new Error('Connector bridge could not start.'));
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', failed);
      resolve();
    });
  });
  expectedHost = `127.0.0.1:${server.address().port}`;
  return {
    url: `http://${expectedHost}/rpc`,
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}
