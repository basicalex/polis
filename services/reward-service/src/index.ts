import { startService } from '@polis/service-runtime';
const port = Number(process.env.PORT ?? process.env.REWARD_SERVICE_PORT ?? 8500);
startService('reward-service', port);
console.log(JSON.stringify({service:'reward-service', port, status:'listening'}));
