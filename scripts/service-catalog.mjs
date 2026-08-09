#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIMES = new Set(['node-24', 'python-3.12']);

const DOC_TARGETS = [
  {
    path: 'README.md',
    start: '<!-- service-catalog:readme:start -->',
    end: '<!-- service-catalog:readme:end -->',
    render: renderReadmeTable,
  },
  {
    path: 'docs/architecture/service-map.md',
    start: '<!-- service-catalog:service-map:start -->',
    end: '<!-- service-catalog:service-map:end -->',
    render: renderServiceMapTable,
  },
  {
    path: '.env.example',
    start: '# service-catalog:env:start',
    end: '# service-catalog:env:end',
    render: renderEnvBlock,
  },
  {
    path: 'polis_interface_v1_agent.env.example',
    start: '# service-catalog:env:start',
    end: '# service-catalog:env:end',
    render: renderEnvBlock,
  },
];

export async function loadCatalog(root = SCRIPT_ROOT) {
  return JSON.parse(await readFile(resolve(root, 'config/services.json'), 'utf8'));
}

export function validateCatalog(catalog, inventory) {
  const errors = [];
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.services)) {
    return ['catalog must have schemaVersion 1 and a services array'];
  }

  const names = new Map();
  const ports = new Map();
  const launchOrders = new Map();
  const envKeys = new Map();
  const catalogPaths = new Set();

  for (const [index, service] of catalog.services.entries()) {
    const label = service?.name || `services[${index}]`;
    for (const key of [
      'name',
      'path',
      'runtime',
      'defaultPort',
      'role',
      'healthRoute',
      'devPortEnv',
      'internalUrlEnv',
      'dev',
    ]) {
      if (service?.[key] === undefined) errors.push(`${label}: missing ${key}`);
    }
    if (!service || typeof service.name !== 'string' || !service.name) continue;

    if (names.has(service.name)) errors.push(`duplicate service name: ${service.name}`);
    names.set(service.name, true);
    if (service.path !== `services/${service.name}`) {
      errors.push(`${service.name}: path must be services/${service.name}, got ${service.path}`);
    }
    catalogPaths.add(service.path);

    if (!RUNTIMES.has(service.runtime)) {
      errors.push(`${service.name}: unsupported runtime ${service.runtime}`);
    }
    if (
      !Number.isInteger(service.defaultPort) ||
      service.defaultPort < 1 ||
      service.defaultPort > 65535
    ) {
      errors.push(`${service.name}: invalid defaultPort ${service.defaultPort}`);
    } else if (ports.has(service.defaultPort)) {
      errors.push(
        `duplicate default port ${service.defaultPort}: ${ports.get(service.defaultPort)} and ${service.name}`,
      );
    } else {
      ports.set(service.defaultPort, service.name);
    }
    if (typeof service.role !== 'string' || !service.role.trim() || service.role.length > 180) {
      errors.push(`${service.name}: role must be 1-180 characters`);
    }
    if (typeof service.healthRoute !== 'string' || !service.healthRoute.startsWith('/')) {
      errors.push(`${service.name}: healthRoute must be an absolute route`);
    }
    for (const field of ['devPortEnv', 'internalUrlEnv']) {
      const key = service[field];
      if (key !== null && (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(key))) {
        errors.push(`${service.name}: ${field} must be null or an uppercase environment key`);
      } else if (key !== null && envKeys.has(key)) {
        errors.push(`duplicate environment key ${key}: ${envKeys.get(key)} and ${service.name}`);
      } else if (key !== null) {
        envKeys.set(key, service.name);
      }
    }

    const nodeService = service.runtime === 'node-24';
    if (nodeService && service.devPortEnv === null) {
      errors.push(`${service.name}: launched Node service needs devPortEnv`);
    }
    if (!nodeService && service.devPortEnv !== null) {
      errors.push(`${service.name}: external runtime devPortEnv must be null`);
    }
    if (nodeService && service.workspace !== `@polis/${service.name}`) {
      errors.push(`${service.name}: Node workspace must be @polis/${service.name}`);
    }
    if (!nodeService && service.workspace !== null) {
      errors.push(`${service.name}: external runtime workspace must be null`);
    }
    if (!service.dev || typeof service.dev.launch !== 'boolean') {
      errors.push(`${service.name}: dev.launch must be boolean`);
    } else if (nodeService && !service.dev.launch) {
      errors.push(`${service.name}: every Node service must launch in dev`);
    } else if (!nodeService && service.dev.launch) {
      errors.push(
        `${service.name}: external runtime must not launch in the Bun TypeScript launcher`,
      );
    }
    if (service.dev?.launch) {
      if (!Number.isInteger(service.dev.order) || service.dev.order < 1) {
        errors.push(`${service.name}: launched service needs a positive dev.order`);
      } else if (launchOrders.has(service.dev.order)) {
        errors.push(
          `duplicate dev order ${service.dev.order}: ${launchOrders.get(service.dev.order)} and ${service.name}`,
        );
      } else {
        launchOrders.set(service.dev.order, service.name);
      }
    } else if (service.dev?.order !== null) {
      errors.push(`${service.name}: non-launched service dev.order must be null`);
    }
  }

  const expectedOrders = Array.from({ length: launchOrders.size }, (_, index) => index + 1);
  const actualOrders = [...launchOrders.keys()].sort((a, b) => a - b);
  if (actualOrders.join(',') !== expectedOrders.join(',')) {
    errors.push(`dev launch order must be contiguous 1-${launchOrders.size}`);
  }

  if (!inventory) return errors;

  const actualPaths = new Set(inventory.serviceDirectories.map((name) => `services/${name}`));
  for (const path of catalogPaths) {
    if (!actualPaths.has(path)) errors.push(`catalog service directory is missing: ${path}`);
  }
  for (const path of actualPaths) {
    if (!catalogPaths.has(path)) errors.push(`service directory is missing from catalog: ${path}`);
  }
  if (!inventory.rootWorkspaces.includes('services/*')) {
    errors.push('root package workspaces must include services/*');
  }

  for (const service of catalog.services) {
    if (!service?.name) continue;
    const found = inventory.entries[service.name];
    if (!found) {
      errors.push(`${service.name}: inventory entry is missing`);
      continue;
    }
    if (service.runtime === 'node-24') {
      if (found.manifestName !== service.workspace) {
        errors.push(
          `${service.name}: manifest/workspace mismatch (catalog ${service.workspace}, manifest ${found.manifestName ?? 'missing'})`,
        );
      }
    } else {
      if (!found.pythonProject) {
        errors.push(`${service.name}: Python runtime requires pyproject.toml`);
      } else if (found.pythonProjectName !== `polis-${service.name}`) {
        errors.push(
          `${service.name}: Python project mismatch (expected polis-${service.name}, found ${found.pythonProjectName ?? 'missing'})`,
        );
      }
      if (found.manifestName)
        errors.push(`${service.name}: external Python service must not be a Node workspace`);
    }
    if (found.sourceDefaultPort === null) {
      errors.push(`${service.name}: could not find a source default port`);
    } else if (found.sourceDefaultPort !== service.defaultPort) {
      errors.push(
        `${service.name}: source default-port mismatch (catalog ${service.defaultPort}, source ${found.sourceDefaultPort})`,
      );
    }
  }

  return errors;
}

export function extractSourceDefaultPort(runtime, source) {
  if (runtime === 'node-24') {
    const match = source.match(/(?:process\.)?env\.PORT[\s\S]{0,160}?\?\?\s*(\d{4,5})/);
    return match ? Number(match[1]) : null;
  }
  if (runtime === 'python-3.12') {
    const match = source.match(
      /(?:os\.environ\.get|os\.getenv)\(\s*["']PORT["']\s*,\s*["'](\d{4,5})["']/,
    );
    return match ? Number(match[1]) : null;
  }
  return null;
}

export async function collectInventory(root, catalog) {
  const serviceDirectories = (await readdir(resolve(root, 'services'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const rootWorkspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : (rootManifest.workspaces?.packages ?? []);
  const entries = {};

  for (const service of catalog.services) {
    const serviceRoot = resolve(root, service.path);
    let manifestName = null;
    let pythonProject = false;
    let pythonProjectName = null;
    try {
      manifestName =
        JSON.parse(await readFile(resolve(serviceRoot, 'package.json'), 'utf8')).name ?? null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const pyproject = await readFile(resolve(serviceRoot, 'pyproject.toml'), 'utf8');
      pythonProject = true;
      pythonProjectName =
        pyproject.match(/\[project\][\s\S]*?^name\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const sourcePath =
      service.runtime === 'python-3.12'
        ? resolve(serviceRoot, 'src/polis_aigateway/__main__.py')
        : resolve(serviceRoot, 'src/index.ts');
    let sourceDefaultPort = null;
    try {
      sourceDefaultPort = extractSourceDefaultPort(
        service.runtime,
        await readFile(sourcePath, 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    entries[service.name] = {
      manifestName,
      pythonProject,
      pythonProjectName,
      sourceDefaultPort,
    };
  }

  return { serviceDirectories, rootWorkspaces, entries };
}

function runtimeLabel(runtime) {
  return runtime === 'node-24' ? 'Node 24' : 'Python 3.12';
}

function devLabel(service) {
  return service.dev.launch ? `Yes (${service.dev.order})` : 'No (external)';
}

export function renderReadmeTable(catalog) {
  const lines = [
    '| Service | Runtime | Port | Summary | Dev launcher |',
    '| --- | --- | ---: | --- | --- |',
  ];
  for (const service of catalog.services) {
    lines.push(
      `| \`${service.name}\` | ${runtimeLabel(service.runtime)} | ${service.defaultPort} | ${service.role} | ${devLabel(service)} |`,
    );
  }
  return lines.join('\n');
}

export function renderServiceMapTable(catalog) {
  const lines = [
    '| Service | Runtime | Port | Role in local v1 | Operational health | Dev order |',
    '| --- | --- | ---: | --- | --- | ---: |',
  ];
  for (const service of catalog.services) {
    lines.push(
      `| \`${service.name}\` | ${runtimeLabel(service.runtime)} | ${service.defaultPort} | ${service.role} | \`GET ${service.healthRoute}\` | ${service.dev.order ?? 'external'} |`,
    );
  }
  return lines.join('\n');
}

export function renderEnvBlock(catalog) {
  const lines = [
    '# Generated by: node scripts/service-catalog.mjs --write',
    '# Node service ports consumed by scripts/dev-services.mjs.',
  ];
  for (const service of catalog.services) {
    if (service.devPortEnv) lines.push(`${service.devPortEnv}=${service.defaultPort}`);
  }
  lines.push('', '# Local-process internal URLs. Compose overrides these with service hostnames.');
  for (const service of catalog.services) {
    if (service.internalUrlEnv) {
      lines.push(`${service.internalUrlEnv}=http://localhost:${service.defaultPort}`);
    }
  }
  lines.push('', '# ai-gateway is external to dev:services; launch it with PORT=8550.');
  return lines.join('\n');
}

export function replaceGeneratedSection(text, start, end, generated) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;
  const afterEnd = endIndex + end.length;
  return `${text.slice(0, startIndex)}${start}\n${generated}\n${end}${text.slice(afterEnd)}`;
}

async function inspectDocs(root, catalog, write) {
  const errors = [];
  const written = [];
  for (const target of DOC_TARGETS) {
    const path = resolve(root, target.path);
    const current = await readFile(path, 'utf8');
    const expected = replaceGeneratedSection(
      current,
      target.start,
      target.end,
      target.render(catalog),
    );
    if (expected === null) {
      errors.push(`${target.path}: generated service catalog markers are missing or malformed`);
    } else if (expected !== current) {
      if (write) {
        await writeFile(path, expected);
        written.push(target.path);
      } else {
        errors.push(`${target.path}: generated service catalog section has drifted (run --write)`);
      }
    }
  }
  return { errors, written };
}

export async function inspectRepository(root = SCRIPT_ROOT, { write = false } = {}) {
  const catalog = await loadCatalog(root);
  const inventory = await collectInventory(root, catalog);
  const errors = validateCatalog(catalog, inventory);
  if (errors.length) return { catalog, inventory, errors, written: [] };
  const docs = await inspectDocs(root, catalog, write);
  return { catalog, inventory, errors: docs.errors, written: docs.written };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--check', '--write'].includes(arg)) ||
    (args.includes('--check') && args.includes('--write'))
  ) {
    console.error('usage: node scripts/service-catalog.mjs [--check|--write]');
    process.exitCode = 2;
    return;
  }
  const write = args.includes('--write');
  const result = await inspectRepository(SCRIPT_ROOT, { write });
  if (result.errors.length) {
    for (const error of result.errors) console.error(`[service-catalog] ${error}`);
    process.exitCode = 1;
    return;
  }
  if (result.written.length) {
    console.log(`[service-catalog] updated ${result.written.join(', ')}`);
  } else {
    console.log(
      `[service-catalog] ${result.catalog.services.length} services valid; generated docs current`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
