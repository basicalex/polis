import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.DOCUMENT_INGESTION_GATEWAY_PORT ?? 8400);
startService('document-ingestion-gateway', port);
console.log(JSON.stringify({service:'document-ingestion-gateway', port, status:'listening'}));
