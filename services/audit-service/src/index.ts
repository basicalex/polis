import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.AUDIT_SERVICE_PORT ?? 8600);
startService('audit-service', port);
console.log(JSON.stringify({service:'audit-service', port, status:'listening'}));
