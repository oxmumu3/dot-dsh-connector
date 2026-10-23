#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { createBridge, isValidToken } from '../src/bridge.js';
import { createProbeService } from '../src/probe.js';

const CONFIG_LIMIT = 64 * 1024;
const schema = z.object({
  publicOnlyHost: z.literal(true),
  principal: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  port: z.number().int().min(0).max(65535).default(31470),
  projects: z.array(z.unknown()).min(1).max(10),
}).passthrough();

async function configuration() {
  const path = process.env.DOT_DSH_CONFIG;
  if (process.argv.length !== 2 || typeof path !== 'string' || !isAbsolute(path)
      || resolve(path) !== path || path.includes('\0') || path.includes('\\')) throw new Error('configuration');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let config;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > CONFIG_LIMIT) throw new Error('configuration');
    const buffer = Buffer.alloc(CONFIG_LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size || bytesRead > CONFIG_LIMIT) throw new Error('configuration');
    config = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))));
  } finally {
    await handle.close();
  }
  const token = process.env[config.tokenEnv];
  if (!isValidToken(token)) throw new Error('configuration');
  return { config, token };
}

let bridge;
try {
  const { config, token } = await configuration();
  // Native enabled/stateDir/isolatedHostHome/model settings are intentionally unused.
  // This independently authorized probe only exposes the explicit public catalog/files.
  const service = createProbeService({ projects: config.projects, principal: config.principal });
  bridge = await createBridge({ service, token, principal: config.principal, port: config.port });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await bridge.close(); process.exitCode = 0; }
    catch { process.stderr.write('Dot DSH read-only probe: shutdown failure.\n'); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdout.write(JSON.stringify({ connection_mode: 'read_only_probe', task_execution: 'unavailable', synthetic: false, url: bridge.url }) + '\n');
} catch {
  await bridge?.close().catch(() => {});
  process.stderr.write('Dot DSH read-only probe: invalid configuration or startup failure.\n');
  process.exitCode = 1;
}
