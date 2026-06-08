import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRoutes } from './index.js';

test('default service contract includes required operational endpoints and v1 APIs', () => { const paths = defaultRoutes('x').map(r => r.path); for (const path of ['/healthz','/readyz','/metrics','/version','/api/v1/governance/institutions','/api/v1/verify/hash']) assert.ok(paths.includes(path)); });
