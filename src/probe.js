import { z } from 'zod';
import { projectAccess, readContext } from './projects.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const optionsSchema = z.object({ projects: z.array(z.unknown()).min(1).max(10), principal: id }).strict();
const readSchemas = {
  list_projects: z.object({}).strict(),
  read_project_context: z.object({ project_id: id }).strict(),
};
const taskTools = new Set(['start_task', 'get_task', 'cancel_task']);
const mode = Object.freeze({ connection_mode: 'read_only_probe', task_execution: 'unavailable', synthetic: false });

function rejected(message, code = 'BACKEND_REJECTED') {
  return Object.assign(new Error(message), { code });
}

/** Actual catalog/file reads only. No core, executor, job store or queue is constructed. */
export function createProbeService(options) {
  const { projects, principal } = optionsSchema.parse(options);
  const access = projectAccess(projects);
  if (access.list(principal).length === 0) throw new Error('Invalid probe configuration.');
  return Object.freeze({
    async call(boundPrincipal, tool, args) {
      if (boundPrincipal !== principal) throw rejected('Project access denied');
      // Fail before argument parsing or context reads: task-shaped requests never create work.
      if (taskTools.has(tool)) throw rejected('Read-only connection probe: DSH task execution is unavailable.', 'BACKEND_OFFLINE');
      if (!Object.hasOwn(readSchemas, tool)) throw rejected('Unknown tool');
      const parsed = readSchemas[tool].parse(args);
      if (tool === 'list_projects') return { ...mode, projects: access.list(principal) };
      return { ...mode, ...await readContext(access.get(principal, parsed.project_id)) };
    },
  });
}
