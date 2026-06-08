import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.ANCHOR_SERVICE_PORT ?? 8440);
startService('anchor-service', port);
console.log(JSON.stringify({service:'anchor-service', port, status:'listening'}));
