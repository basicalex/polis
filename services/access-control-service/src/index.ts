import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.ACCESS_CONTROL_SERVICE_PORT ?? 8450);
startService('access-control-service', port);
console.log(JSON.stringify({service:'access-control-service', port, status:'listening'}));
