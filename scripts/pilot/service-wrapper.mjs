import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { assertOwnedRuntime, parseArgs, readJson } from './runtime-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const runtimePath = path.resolve(args.value('runtime') ?? '');
const name = args.value('name');
if (!runtimePath || !name || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
  process.exitCode = 64;
} else {
  const { paths } = await assertOwnedRuntime(runtimePath);
  const configPath = path.join(paths.serviceDir, `${name}.json`);
  const config = await readJson(configPath);
  if (
    !Array.isArray(config.command) ||
    config.command.length === 0 ||
    !config.command.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('managed service command is invalid');
  }
  const [command, ...commandArgs] = config.command;
  const log = await open(path.join(paths.serviceLogDir, `${name}.log`), 'a', 0o600);
  const child = spawn(command, commandArgs, {
    cwd: config.cwd,
    env: config.env,
    stdio: ['ignore', log.fd, log.fd],
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', () => clearTimeout(timer));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', () => process.exit(1));
  child.once('exit', async (code, signal) => {
    await log.write(
      `[pilot-wrapper] child exited code=${code ?? 'unknown'} signal=${signal ?? 'none'}\n`,
    );
    await log.close();
    if (signal || stopping) process.exit(0);
    process.exit(code ?? 1);
  });
}
