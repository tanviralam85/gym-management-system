import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createPortProbe } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const host = '127.0.0.1';
const databaseName = 'lion_gym_dev';
const firstLoginFile = '.local/owner-first-login.txt';
const prismaCli = 'node_modules/prisma/build/index.js';

function runNode(args) {
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

function prepareEnvironment(databaseDir) {
  mkdirSync('.local', { recursive: true });
  if (!existsSync('.env')) {
    if (existsSync(resolve(databaseDir, 'PG_VERSION'))) {
      throw new Error('Restore your original .env to reuse the existing local database.');
    }
    const password = randomBytes(24).toString('hex');
    writeFileSync('.env', [
      'API_PORT=3000',
      'WEB_ORIGIN=http://127.0.0.1:5173',
      `DATABASE_URL=postgresql://lion_local:${password}@127.0.0.1:25432/${databaseName}`,
      '',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
  }
  process.loadEnvFile('.env');
}

function prepareDependencies() {
  const fingerprint = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
  const installed = '.local/dependencies.sha256';
  if (existsSync(installed) && readFileSync(installed, 'utf8') === fingerprint &&
      ['vite', 'prisma', 'embedded-postgres'].every((name) => existsSync('node_modules/' + name + '/package.json'))) return;
  if (!process.env.npm_execpath) throw new Error('Start from the repository root with npm run dev.');
  console.log('Installing Lion Gym dependencies from the lockfile.');
  runNode([process.env.npm_execpath, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund']);
  writeFileSync(installed, fingerprint);
}

async function setupDatabase(pg) {
  const maintenance = pg.getPgClient('postgres');
  await maintenance.connect();
  try {
    const { rowCount } = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!rowCount) await pg.createDatabase(databaseName);
  } finally {
    await maintenance.end();
  }
  runNode([prismaCli, 'migrate', 'deploy']);

  const client = pg.getPgClient(databaseName);
  await client.connect();
  try {
    const { rowCount } = await client.query(`SELECT 1 FROM "Account" WHERE role = 'OWNER' LIMIT 1`);
    if (!rowCount) {
      runNode(['dist/api/auth/bootstrap-owner.js', 'lion.owner', '--save-local-credentials']);
      console.log(`First sign-in for lion.owner: open ${firstLoginFile} in VS Code.`);
    }
  } finally {
    await client.end();
  }
}

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
  prepareEnvironment(databaseDir);
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env or use the generated local configuration.');
  const database = new URL(process.env.DATABASE_URL);
  const web = new URL(process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173');
  const databasePort = Number(database.port || 5432);
  const apiPort = Number(process.env.API_PORT ?? 3000);
  const webPort = Number(web.port || 80);
  if (database.hostname !== host || database.pathname !== '/' + databaseName ||
      !['postgresql:', 'postgres:'].includes(database.protocol) || database.search || database.hash ||
      !database.username || !database.password || web.hostname !== host || web.protocol !== 'http:' ||
      new Set([databasePort, apiPort, webPort]).size !== 3 ||
      ![databasePort, apiPort, webPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
    throw new Error('Use the local lion_gym_dev database and distinct ports on 127.0.0.1. For an external database, see README.md.');
  }

  await requireFreePort(databasePort, 'PostgreSQL');
  await requireFreePort(apiPort, 'API');
  await requireFreePort(webPort, 'Web');
  prepareDependencies();
  runNode([prismaCli, 'generate']);
  runNode(['node_modules/typescript/bin/tsc', '-p', 'api/tsconfig.json']);

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const { createServer: createViteServer } = await import('vite');
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: databasePort,
    user: decodeURIComponent(database.username),
    password: decodeURIComponent(database.password),
    authMethod: 'scram-sha-256',
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
    if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
    if (shutdown.signal.aborted) return;
    await pg.start();
    databaseStarted = true;
    console.log('Lion Gym PostgreSQL is running.');
    if (shutdown.signal.aborted) return;
    await setupDatabase(pg);
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
