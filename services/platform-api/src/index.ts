import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.PLATFORM_API_PORT ?? 8080);
startService('platform-api', port);
console.log(JSON.stringify({service:'platform-api', port, status:'listening'}));
