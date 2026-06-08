import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.NOTIFICATION_SERVICE_PORT ?? 8700);
startService('notification-service', port);
console.log(JSON.stringify({service:'notification-service', port, status:'listening'}));
