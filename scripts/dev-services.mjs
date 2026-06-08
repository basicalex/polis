import { spawn } from 'node:child_process';
const services=['platform-api','governance-graph-api','polis-adapter','ai-orchestrator','assessment-engine','document-proof-service','verifier-api','reward-service','audit-service'];
for (const service of services) spawn('pnpm',['--filter',`@polis/${service}`,'start'],{stdio:'inherit'});
