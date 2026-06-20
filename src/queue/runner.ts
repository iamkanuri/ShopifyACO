import process from "node:process";
import { ENV } from "../server/env.js";
import { claim, complete, fail, heartbeat, recoverAbandoned, touchHeartbeat } from "./jobs.js";
import { getHandler } from "./handlers.js";

// Shared worker loop, used by both the standalone worker process (src/worker.ts) and
// the optional in-process worker the web server can start (WORKER_IN_PROCESS=1).

export interface WorkerHandle {
  id: string;
  stop: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startWorker(tag = "worker"): WorkerHandle {
  const id = `${ENV.commit.slice(0, 7)}-${tag}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  let stopping = false;

  async function runOne(): Promise<boolean> {
    const job = await claim(id, {
      globalLimit: ENV.queue.globalConcurrency,
      shopLimit: ENV.queue.shopConcurrency,
      emailLimit: ENV.queue.emailConcurrency,
      leaseSec: ENV.queue.leaseSec,
    });
    if (!job) return false;
    const hb = setInterval(() => {
      heartbeat(job.id, id, ENV.queue.leaseSec).catch(() => {});
    }, Math.max(5_000, (ENV.queue.leaseSec * 1000) / 3));
    try {
      const handler = getHandler(job.type);
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      const result = await handler(job.payload, { jobId: job.id, attempt: job.attempts });
      await complete(job.id, result);
      console.log(`[worker ${id}] job ${job.id} (${job.type}) completed`);
    } catch (err) {
      const decision = await fail(job.id, (err as Error).message);
      console.warn(`[worker ${id}] job ${job.id} (${job.type}) failed → ${decision}: ${(err as Error).message}`);
    } finally {
      clearInterval(hb);
    }
    return true;
  }

  const hbTimer = setInterval(() => touchHeartbeat(`worker:${id}`, { pid: process.pid }).catch(() => {}), 15_000);

  (async function loop() {
    try {
      const recovered = await recoverAbandoned(ENV.queue.recoverGraceSec);
      if (recovered) console.log(`[worker ${id}] recovered ${recovered} abandoned job(s)`);
    } catch (err) {
      console.error(`[worker ${id}] startup recovery failed:`, (err as Error).message);
    }
    console.log(`[worker ${id}] up (poll ${ENV.queue.pollMs}ms, global cap ${ENV.queue.globalConcurrency})`);
    while (!stopping) {
      try {
        const did = await runOne();
        if (!did) await sleep(ENV.queue.pollMs);
      } catch (err) {
        console.error(`[worker ${id}] loop error:`, (err as Error).message);
        await sleep(ENV.queue.pollMs);
      }
    }
    clearInterval(hbTimer);
    console.log(`[worker ${id}] stopped`);
  })();

  return { id, stop: () => { stopping = true; } };
}
