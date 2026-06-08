import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.PAPERLESS_ADAPTER_PORT ?? 8401);
startService('paperless-adapter', port);
console.log(JSON.stringify({service:'paperless-adapter', port, status:'listening'}));
