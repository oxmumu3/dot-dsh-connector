import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { publicError } from './bridge.js';

const id = () => z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const definitions = [
  ['list_projects', 'List projects explicitly allowlisted for this connector.', z.strictObject({}), false],
  ['read_project_context', 'Read bounded project context from an allowlisted project.', z.strictObject({ project_id: id() }), false],
  ['start_task', 'Start an explicitly requested, bounded read-only DSH task. Creates a DSH session/job; reuse request_id for retries. User acceptance remains unverified.', z.strictObject({ project_id: id(), task: z.string().trim().min(1).max(2000), request_id: id() }), true],
  ['get_task', 'Read the status and bounded result of a connector-owned DSH job. Succeeded requires a correlated turn/end; user acceptance remains unverified.', z.strictObject({ job_id: id() }), false],
  ['cancel_task', 'Request cancellation of a connector-owned DSH job. This mutates job state and does not undo completed work.', z.strictObject({ job_id: id() }), true],
];
const nonControl = (max, min = 1) => z.string().min(min).max(max).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/);
const offset = () => z.number().int().nonnegative().optional();
const limit = () => z.number().int().min(1).max(100).optional();
const harnessDefinitions = [
  ['harness_status', 'Read the authenticated Harness connection status.', z.strictObject({}), false],
  ['harness_list_workspaces', 'List Harness workspaces with bounded pagination.', z.strictObject({ offset: offset(), limit: limit() }), false],
  ['harness_list_sessions', 'List or search Harness sessions with bounded pagination.', z.strictObject({ workspace_id: nonControl(512).optional(), query: z.string().max(200).optional(), offset: offset(), limit: limit() }), false],
  ['harness_read_session', 'Read a bounded page of a Harness session.', z.strictObject({ session_id: nonControl(256), offset: offset().describe('Use returned next_offset; omit/0 for latest.'), limit: limit() }), false],
  ['harness_list_directory', 'List a bounded page of a directory in a Harness workspace.', z.strictObject({ workspace_id: nonControl(512), path: nonControl(2000, 0).optional(), offset: offset(), limit: limit() }), false],
  ['harness_read_file', 'Read a bounded byte range from a file in a Harness workspace.', z.strictObject({ workspace_id: nonControl(512), path: nonControl(2000), offset: offset(), max_bytes: z.number().int().min(1).max(32768).optional() }), false],
];
const nativeDefinitions = [
  ['harness_start_task','Start an explicitly requested task in an existing Harness project workspace using its normal model, tools and approval policy. May edit files and run commands. Creates a new connector-owned session; reuse request_id on retry.',z.strictObject({workspace_id:nonControl(512),task:z.string().trim().min(1).max(8000),request_id:id()}),true],
  ['harness_get_task','Read the observed state and bounded result of a connector-owned native Harness task, including pending approvals or questions. Acceptance or idle is not proof of completion.',z.strictObject({job_id:id()}),false],
  ['harness_list_tasks','Find connector-owned native tasks by workspace, status or original request_id, including lost receipts. Defaults to unarchived tasks; archived=true lists archived tasks. Results use bounded pagination.',z.strictObject({offset:offset(),limit:limit(),workspace_id:nonControl(512).optional(),status:z.enum(['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown']).optional(),request_id:id().optional(),archived:z.boolean().optional()}),false],
  ['harness_archive_task','Archive or unarchive a finished connector-owned task in the connector list. Does not delete its session or request identity. Only succeeded, failed or cancelled tasks can be archived; archived defaults to true.',z.strictObject({job_id:id(),archived:z.boolean().optional()}),true],
  ['harness_followup_task','Send an explicitly requested follow-up in the same connector-owned Harness session using normal tools and approvals. Default after_complete requires a completed task; queue adds a next-turn instruction to an active task, and steer adds an instruction to its running turn. Returns a distinct attempt/job with its own message identity. May edit files and run commands; reuse request_id.',z.strictObject({job_id:id(),task:z.string().trim().min(1).max(8000),request_id:id(),mode:z.enum(['after_complete','queue','steer']).optional()}),true],
  ['harness_cancel_task','Request cancellation of a connector-owned native Harness task only. Does not undo completed file changes or commands.',z.strictObject({job_id:id()}),true],
];

/** Tool registration is metadata only. No backend call occurs until tools/call. */
export function createMcpServer({ call, harnessRead = false, harnessExecution = false,fixtureTasks=true } = {}) {
  if (typeof call !== 'function' || typeof harnessRead !== 'boolean' || typeof harnessExecution !== 'boolean'||typeof fixtureTasks!=='boolean'||!fixtureTasks&&!harnessRead&&!harnessExecution) throw new Error('Invalid connector configuration.');
  const server = new McpServer({ name: 'dot-dsh-connector', version: '0.4.0-preview.1' }, { maxToolInputElements: 32 });
  const selected=[...fixtureTasks?definitions:[],...harnessRead?harnessDefinitions:[],...harnessExecution?nativeDefinitions:[]];
  for (const [name, description, inputSchema, mutating] of selected) {
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: !mutating,
        destructiveHint: name === 'cancel_task' || name === 'harness_cancel_task',
        idempotentHint: true,
        openWorldHint: name === 'harness_start_task' || name === 'harness_followup_task',
      },
    }, async (args) => {
      try {
        const value = await call(name, args);
        return { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: publicError(error) }) }] };
      }
    });
  }
  return server;
}
