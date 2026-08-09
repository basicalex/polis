import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSourceDefaultPort,
  inspectRepository,
  renderEnvBlock,
  replaceGeneratedSection,
  validateCatalog,
} from './service-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const catalog = {
    schemaVersion: 1,
    services: [
      {
        name: 'alpha',
        path: 'services/alpha',
        workspace: '@polis/alpha',
        runtime: 'node-24',
        defaultPort: 8001,
        role: 'Alpha service.',
        healthRoute: '/readyz',
        devPortEnv: 'ALPHA_PORT',
        internalUrlEnv: 'ALPHA_INTERNAL_URL',
        dev: { launch: true, order: 1 },
      },
      {
        name: 'ai-gateway',
        path: 'services/ai-gateway',
        workspace: null,
        runtime: 'python-3.12',
        defaultPort: 8002,
        role: 'AI gateway.',
        healthRoute: '/readyz',
        devPortEnv: null,
        internalUrlEnv: 'AI_INTERNAL_URL',
        dev: { launch: false, order: null },
      },
    ],
  };
  const inventory = {
    serviceDirectories: ['ai-gateway', 'alpha'],
    rootWorkspaces: ['services/*'],
    entries: {
      alpha: { manifestName: '@polis/alpha', pythonProject: false, sourceDefaultPort: 8001 },
      'ai-gateway': {
        manifestName: null,
        pythonProject: true,
        pythonProjectName: 'polis-ai-gateway',
        sourceDefaultPort: 8002,
      },
    },
  };
  return { catalog, inventory };
}

test('the repository catalog, source ports, workspaces, and generated docs agree', async () => {
  const result = await inspectRepository(ROOT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.catalog.services.length, 18);
});

test('validator rejects duplicate identity and port drift', () => {
  const { catalog, inventory } = fixture();
  catalog.services[1].name = 'alpha';
  catalog.services[1].path = 'services/alpha';
  catalog.services[1].defaultPort = 8001;
  const errors = validateCatalog(catalog, inventory);
  assert(errors.some((error) => error.includes('duplicate service name: alpha')));
  assert(errors.some((error) => error.includes('duplicate default port 8001')));
});

test('validator rejects directory, manifest, and source default-port drift', () => {
  const { catalog, inventory } = fixture();
  inventory.serviceDirectories = ['ai-gateway', 'extra'];
  inventory.entries.alpha.manifestName = '@polis/not-alpha';
  inventory.entries.alpha.sourceDefaultPort = 8999;
  const errors = validateCatalog(catalog, inventory);
  assert(errors.includes('catalog service directory is missing: services/alpha'));
  assert(errors.includes('service directory is missing from catalog: services/extra'));
  assert(errors.some((error) => error.includes('manifest/workspace mismatch')));
  assert(errors.some((error) => error.includes('source default-port mismatch')));
});

test('source port extraction covers Node and Python entrypoints', () => {
  assert.equal(
    extractSourceDefaultPort(
      'node-24',
      'const port = Number(process.env.PORT ?? process.env.ALPHA_PORT ?? 8123);',
    ),
    8123,
  );
  assert.equal(
    extractSourceDefaultPort('python-3.12', 'port=int(os.environ.get("PORT", "8550"))'),
    8550,
  );
});

test('generated section replacement is targeted and rejects missing markers', () => {
  const before = 'before\n<!-- start -->\nstale\n<!-- end -->\nafter\n';
  assert.equal(
    replaceGeneratedSection(before, '<!-- start -->', '<!-- end -->', 'fresh'),
    'before\n<!-- start -->\nfresh\n<!-- end -->\nafter\n',
  );
  assert.equal(replaceGeneratedSection('no markers', '<!-- start -->', '<!-- end -->', 'x'), null);
});

test('generated env block uses local URLs and excludes the external Python port', () => {
  const { catalog } = fixture();
  const rendered = renderEnvBlock(catalog);
  assert.match(rendered, /ALPHA_PORT=8001/);
  assert.match(rendered, /ALPHA_INTERNAL_URL=http:\/\/localhost:8001/);
  assert.match(rendered, /AI_INTERNAL_URL=http:\/\/localhost:8002/);
  assert.doesNotMatch(rendered, /AI_GATEWAY_PORT/);
});
