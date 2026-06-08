import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.DOCUMENT_PROOF_SERVICE_PORT ?? 8410);
startService('document-proof-service', port);
console.log(JSON.stringify({service:'document-proof-service', port, status:'listening'}));
