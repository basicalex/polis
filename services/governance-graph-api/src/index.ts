import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.GOVERNANCE_GRAPH_API_PORT ?? 8100);
startService('governance-graph-api', port);
console.log(JSON.stringify({service:'governance-graph-api', port, status:'listening'}));
