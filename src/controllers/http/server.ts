// HTTP API for the web UI. Usage: npm run api [-- --port 3000] [-- --no-worker]
// Runs the outbox worker in the same process unless --no-worker is given (then run `npm run worker`).
import pc from 'picocolors';
import { createApp } from '../../bootstrap';
import { buildServer } from './routes';

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const port = Number(option('--port') ?? process.env.PORT ?? 3000);
  const host = option('--host') ?? '127.0.0.1';
  const app = await createApp({
    ...(option('--config') ? { configPath: option('--config') } : {}),
  });
  const server = await buildServer(app.services, { log: (line) => console.log(pc.dim(line)) });

  const stop = new AbortController();
  const worker = process.argv.includes('--no-worker')
    ? undefined
    : app
        .createWorker({ log: (line) => console.log(line) })
        .run(stop.signal)
        .catch((error: Error) => console.error(pc.red(`[worker] stopped: ${error.message}`)));

  const shutdown = async () => {
    stop.abort();
    await server.close();
    await worker;
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await server.listen({ port, host });
  const wf = app.workflow;
  console.log(
    `${pc.green('✓')} API on http://${host}:${port}/api · workflow ${wf.id} v${wf.version} (${wf.hash.slice(0, 12)}) · schema ${app.schema}${worker ? ' · outbox worker running' : ''}`,
  );
}

main().catch((error) => {
  console.error(pc.red(`api failed to start: ${(error as Error).message}`));
  process.exitCode = 1;
});
