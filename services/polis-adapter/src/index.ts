import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.POLIS_ADAPTER_PORT ?? 8110);
startService('polis-adapter', port);
console.log(JSON.stringify({service:'polis-adapter', port, status:'listening'}));
