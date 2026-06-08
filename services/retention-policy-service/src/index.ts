import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.RETENTION_POLICY_SERVICE_PORT ?? 8470);
startService('retention-policy-service', port);
console.log(JSON.stringify({service:'retention-policy-service', port, status:'listening'}));
