import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.SEARCH_SERVICE_PORT ?? 8800);
startService('search-service', port);
console.log(JSON.stringify({service:'search-service', port, status:'listening'}));
