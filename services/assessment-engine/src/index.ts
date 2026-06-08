import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.ASSESSMENT_ENGINE_PORT ?? 8300);
startService('assessment-engine', port);
console.log(JSON.stringify({service:'assessment-engine', port, status:'listening'}));
