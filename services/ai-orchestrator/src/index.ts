import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.AI_ORCHESTRATOR_PORT ?? 8200);
startService('ai-orchestrator', port);
console.log(JSON.stringify({service:'ai-orchestrator', port, status:'listening'}));
