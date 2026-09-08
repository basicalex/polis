import { verifyIntakeClosed } from './intake-closed-check.mjs';

await verifyIntakeClosed({
  base: process.env.TRACE_INTERNAL_URL,
  token: process.env.INTERNAL_API_TOKEN,
  testMarker: process.env.PILOT_TEST_DATABASE_MARKER,
});
console.log(JSON.stringify({ intakeClosed: 'verified', scope: 'local-only' }));
