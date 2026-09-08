import { PilotError } from './runtime-lib.mjs';

export function applyTraceIntakeOverride(launch, value) {
  if (value !== 'true' && value !== 'false') {
    throw new PilotError(
      'trace intake override must be TRACE_INTAKE_OPEN=true or TRACE_INTAKE_OPEN=false',
    );
  }
  return {
    ...launch,
    traceExtraEnv: {
      ...launch.traceExtraEnv,
      TRACE_INTAKE_OPEN: value,
    },
  };
}

export function traceServiceDefinition(runtime, launch, serviceEnvironment) {
  return {
    command: launch.traceStartCommand,
    env: serviceEnvironment(runtime, { PORT: '8980', ...launch.traceExtraEnv }),
    healthUrl: 'http://127.0.0.1:8980/readyz',
    cwd: runtime.metadata.repoRoot,
  };
}
