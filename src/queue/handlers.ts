// Job-type → handler registry. Handlers receive the job payload and a context, and
// return a JSON-serializable result stored on the job. New job types register here;
// the worker dispatches by `job.type`. Keeping this separate keeps the worker generic.

export interface JobContext {
  jobId: number;
  attempt: number;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<Record<string, unknown>>;

const registry = new Map<string, JobHandler>();

export function registerHandler(type: string, fn: JobHandler): void {
  registry.set(type, fn);
}

export function getHandler(type: string): JobHandler | undefined {
  return registry.get(type);
}

export function registeredTypes(): string[] {
  return [...registry.keys()];
}

// Built-in no-op handler — used by integration tests and queue health smoke checks.
// Real handlers (e.g. 'scan') are registered when the live scan path is wired to the
// queue (Phase 1 integration step — see IMPLEMENTATION_STATUS.md).
registerHandler("noop", async (payload) => ({ ok: true, echoed: payload }));
