import { spawn } from 'node:child_process';

const [secondsText, separator, command, ...args] = process.argv.slice(2);
const timeoutSeconds = Number(secondsText);
if (
  !Number.isFinite(timeoutSeconds) ||
  timeoutSeconds <= 0 ||
  separator !== '--' ||
  !command
) {
  console.error('usage: bun scripts/run-with-timeout.mjs <seconds> -- <command> [args...]');
  process.exitCode = 2;
} else {
  const detached = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    detached,
  });

  let timedOut = false;
  let forceTimer;

  function signalChild(signal) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (detached && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  const forwardSignal = (signal) => signalChild(signal);
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    console.error(`timeout after ${timeoutSeconds}s: ${command}`);
    signalChild('SIGTERM');
    forceTimer = setTimeout(() => signalChild('SIGKILL'), 5_000);
    forceTimer.unref();
  }, timeoutSeconds * 1_000);
  timeoutTimer.unref();

  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  }).catch((error) => ({ error }));

  clearTimeout(timeoutTimer);
  clearTimeout(forceTimer);
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);

  if (outcome.error) {
    console.error(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
    process.exitCode = 1;
  } else if (timedOut) {
    process.exitCode = 124;
  } else if (outcome.signal) {
    console.error(`${command} exited from ${outcome.signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = outcome.code ?? 1;
  }
}
