import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer as createPortProbe } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';

const host = '127.0.0.1';

async function requireFreePort(port, name) {
  const probe = createPortProbe();
  probe.listen({ host, port, exclusive: true });
  try {
    await once(probe, 'listening');
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(`${name} port ${port} is already in use. Stop the existing instance before running this command.`);
    }
    throw error;
  }
  await new Promise((done) => probe.close(done));
}

async function waitForApi(origin, api, signal) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (api.exitCode !== null || api.signalCode !== null) throw new Error('The API stopped during startup.');
    try {
      const response = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // The API is still starting.
    }
    await delay(200, undefined, { signal });
  }
  throw new Error('The web app could not reach the API.');
}

async function start() {
  const databaseDir = resolve('.local/postgres-data');
  const runtime = new URL('../.local/node_modules/embedded-postgres/dist/index.js', import.meta.url);
  if (!process.env.DATABASE_URL || !existsSync(runtime) || !existsSync(resolve(databaseDir, 'PG_VERSION'))) {
    throw new Error('The local PostgreSQL setup is missing. See the local setup section in README.md.');
  }

  const database = new URL(process.env.DATABASE_URL);
  const web = new URL(process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173');
  const databasePort = Number(database.port || 5432);
  const apiPort = Number(process.env.API_PORT ?? 3000);
  const webPort = Number(web.port || 80);
  if (database.hostname !== host || web.hostname !== host || web.protocol !== 'http:' ||
      new Set([databasePort, apiPort, webPort]).size !== 3 ||
      ![databasePort, apiPort, webPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
    throw new Error('The local launcher requires distinct database, API and web ports on 127.0.0.1.');
  }

  await requireFreePort(databasePort, 'PostgreSQL');
  await requireFreePort(apiPort, 'API');
  await requireFreePort(webPort, 'Web');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'api/tsconfig.json'], { stdio: 'inherit' });

  const { default: EmbeddedPostgres } = await import(runtime.href);
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: databasePort,
    user: decodeURIComponent(database.username),
    password: decodeURIComponent(database.password),
    persistent: true,
    autoRehydrateSymlinks: true,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
  });

  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let databaseStarted = false;
  let api;
  let vite;
  try {
    await pg.start();
    databaseStarted = true;
    console.log('Lion Gym PostgreSQL is running.');
    if (shutdown.signal.aborted) return;

    api = spawn(process.execPath, ['dist/api/main.js'], { stdio: 'inherit', windowsHide: true });
    const apiStopped = Promise.race([once(api, 'exit'), once(api, 'error')])
      .then(() => { if (!shutdown.signal.aborted) throw new Error('The API stopped.'); })
      .catch((error) => error);
    await waitForApi(`http://${host}:${apiPort}`, api, shutdown.signal);
    vite = await createViteServer({
      root: 'web', configFile: 'web/vite.config.ts', server: { port: webPort },
    });
    await vite.listen();
    const health = await fetch(web.origin + '/api/v1/health', { signal: AbortSignal.timeout(2000) });
    if (!health.ok || (await health.json()).status !== 'ok') throw new Error('The web app could not reach the API.');
    console.log(`Lion Gym is ready at ${web.origin}. Press Ctrl+C to stop.`);

    const result = await Promise.race([
      apiStopped,
      shutdown.signal.aborted ? undefined : once(shutdown.signal, 'abort'),
    ]);
    if (result instanceof Error) throw result;
  } catch (error) {
    if (!shutdown.signal.aborted || error.name !== 'AbortError') throw error;
  } finally {
    stop();
    try {
      await vite?.close();
    } finally {
      try {
        if (api?.pid && api.exitCode === null && api.signalCode === null) {
          const exited = once(api, 'exit');
          api.kill();
          await exited;
        }
      } finally {
        if (databaseStarted) await pg.stop();
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    }
  }
}

try {
  await start();
} catch (error) {
  console.error('Lion Gym could not start:', error.message);
  process.exitCode = 1;
}
