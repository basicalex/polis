import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ASTRO_COMPONENTS = [
  'DemoBadge',
  'StatusBadge',
  'ConfidenceBadge',
  'ReviewStateBadge',
  'RiskBadge',
  'AssessmentBadge',
  'TrustStrip',
  'VerdictCard',
  'ProofManifestView',
  'AuditTrail',
  'SourcePanel',
  'MechanismTable',
  'ProofTruthNote',
  'AiLabel',
];

test('all spec-mandated astro components exist', () => {
  for (const name of ASTRO_COMPONENTS) {
    assert.ok(
      existsSync(join(pkgRoot, 'src', 'astro', `${name}.astro`)),
      `missing astro/${name}.astro`,
    );
  }
});

test('react verifier components exist', () => {
  for (const file of ['VerifierFlow.tsx', 'VerifierResult.tsx', 'useFileHash.ts']) {
    assert.ok(existsSync(join(pkgRoot, 'src', 'react', file)), `missing react/${file}`);
  }
});

test('stylesheets exist and define both themes', () => {
  const base = readFileSync(join(pkgRoot, 'src', 'styles', 'base.css'), 'utf8');
  assert.match(base, /\[data-theme='dark'\]/);
  assert.match(base, /\[data-theme='light'\]/);
  for (const tone of ['valid', 'warning', 'invalid', 'unknown', 'restricted']) {
    assert.match(base, new RegExp(`--trust-${tone}-fg`), `missing --trust-${tone}-fg token`);
  }
  assert.ok(existsSync(join(pkgRoot, 'src', 'styles', 'tailwind.css')));
});

test('package exports map covers styles, astro, react, and messages', () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  for (const key of ['./styles/base.css', './astro/*', './react/*', './messages']) {
    assert.ok(key in pkg.exports, `missing export ${key}`);
  }
});

test('ui components never use tailwind utility classes (plain-CSS app compatibility)', () => {
  // Spot-check: semantic classes only. Tailwind utilities like `flex`, `p-4`,
  // `text-sm` in class attributes would break verifier/vault/admin.
  const suspicious = /class=("|')([^"']*\b(?:p-\d|m-\d|text-(?:xs|sm|lg|xl)|flex\b|grid-cols)\b)/;
  for (const name of ASTRO_COMPONENTS) {
    const source = readFileSync(join(pkgRoot, 'src', 'astro', `${name}.astro`), 'utf8');
    assert.ok(!suspicious.test(source), `${name}.astro appears to use tailwind utilities`);
  }
});
