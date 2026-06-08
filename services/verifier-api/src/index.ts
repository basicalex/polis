import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.VERIFIER_API_PORT ?? 8420);
startService('verifier-api', port);
console.log(JSON.stringify({service:'verifier-api', port, status:'listening'}));
