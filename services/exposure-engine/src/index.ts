import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.EXPOSURE_ENGINE_PORT ?? 8310);
startService('exposure-engine', port);
console.log(JSON.stringify({service:'exposure-engine', port, status:'listening'}));
