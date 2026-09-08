import { PilotError, TEST_MARKER } from './runtime-lib.mjs';

export function intakeClosedRequest(base, token) {
  return {
    url: `${base.replace(/\/$/, '')}/internal/trace/records`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-polis-internal-token': token,
        'x-polis-citizen': 'trace-resident-test',
        'x-polis-identity-level': 'verified',
        'idempotency-key': '10000000-0000-4000-8000-000000000002',
      },
      body: JSON.stringify({
        subject: 'closed intake check',
        narrative: 'synthetic only',
        location: 'synthetic only',
      }),
      signal: AbortSignal.timeout(5_000),
    },
  };
}

export async function verifyIntakeClosed({ base, token, testMarker, fetchImpl = fetch }) {
  if (testMarker !== TEST_MARKER) {
    throw new PilotError('intake checker requires the explicit pilot test marker');
  }
  if (!base || !token) {
    throw new PilotError('intake checker requires the local trace URL and internal token');
  }
  const request = intakeClosedRequest(base, token);
  const response = await fetchImpl(request.url, request.init);
  const body = await response.json().catch(() => null);
  if (response.status !== 503 || body?.error !== 'intake_closed') {
    throw new PilotError(
      `trace intake verifier expected 503 intake_closed; got ${response.status}`,
    );
  }
}
