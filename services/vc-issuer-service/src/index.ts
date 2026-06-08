import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.VC_ISSUER_SERVICE_PORT ?? 8430);
startService('vc-issuer-service', port);
console.log(JSON.stringify({service:'vc-issuer-service', port, status:'listening'}));
