import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.REDACTION_SERVICE_PORT ?? 8460);
startService('redaction-service', port);
console.log(JSON.stringify({service:'redaction-service', port, status:'listening'}));
