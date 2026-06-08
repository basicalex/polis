import { spawn } from 'node:child_process';
const svc=spawn('node',['services/platform-api/dist/index.js'],{stdio:['ignore','pipe','pipe']});
await new Promise(r=>setTimeout(r,500));
try { for (const path of ['/healthz','/version','/api/v1/governance/institutions','/api/v1/evidence/claims','/api/v1/polis/conversations','/api/v1/rewards/rules']) { const res=await fetch(`http://127.0.0.1:8080${path}`); if(!res.ok) throw new Error(`${path} ${res.status}`); } const verify=await fetch('http://127.0.0.1:8080/api/v1/verify/hash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'demo'})}); const body=await verify.json(); if(!body.ok) throw new Error('proof verification failed'); console.log('v1 smoke ok'); } finally { svc.kill('SIGTERM'); }
