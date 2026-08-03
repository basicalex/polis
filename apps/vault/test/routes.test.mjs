import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('vault has required v1 routes', async()=>{ const index=await readFile(new URL('../src/pages/index.astro', import.meta.url),'utf8'); assert.match(index, /Citizen Vault/); });

function createDom() {
  const textAssignments = [];
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.style = {};
      this.value = '';
    }

    set textContent(value) {
      this._textContent = String(value);
      textAssignments.push(this._textContent);
    }

    get textContent() { return this._textContent; }
    get firstElementChild() { return this.children.find((child) => child instanceof Element); }
    set innerHTML(_) { throw new Error('unsafe innerHTML rendering'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
  }

  const elements = new Map(
    ['auth-required', 'vault-content', 'docs-list', 'add-error', 'add-btn', 'proof-id', 'label']
      .map((id) => [id, new Element('div')]),
  );
  return {
    document: {
      createElement: (tagName) => new Element(tagName),
      getElementById: (id) => elements.get(id),
    },
    elements,
    textAssignments,
  };
}

async function nextTask() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('vault documents renders malicious API values and errors as text', async () => {
  const documents = await readFile(new URL('../src/pages/documents.astro', import.meta.url), 'utf8');
  const script = documents.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'vault client script is present');
  assert.doesNotMatch(documents, /\.innerHTML\s*=/);

  const hostileValues = [
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<script>alert(1)</script>',
    '<a href=javascript:alert(1)>issuer</a>',
    '<button onclick="alert(1)">added</button>',
  ];
  const addError = '<img src=x onerror=alert(1)>add failed';
  const { document, elements, textAssignments } = createDom();
  const fetch = async (_, options = {}) => {
    if (options.method === 'POST') {
      return { ok: false, json: async () => ({ error: addError }) };
    }
    return {
      ok: true,
      json: async () => ({
        items: [{
          label: hostileValues[0],
          proofManifestId: hostileValues[1],
          proof: { issuerName: hostileValues[2], registryStatus: hostileValues[3] },
          addedAt: hostileValues[4],
        }],
      }),
    };
  };
  new Function('window', 'sessionStorage', 'document', 'fetch', script)(
    { __API_URL: 'https://api.example.test' },
    { getItem: () => JSON.stringify({ token: 'vault-token' }) },
    document,
    fetch,
  );
  await nextTask();

  for (const value of hostileValues) assert.ok(textAssignments.includes(value));
  elements.get('label').value = 'A safe label';
  await elements.get('add-btn').listeners.get('click')();
  assert.equal(elements.get('add-error').textContent, addError);

  const loadError = '<svg onload=alert(1)>load failed';
  const errorDom = createDom();
  new Function('window', 'sessionStorage', 'document', 'fetch', script)(
    { __API_URL: 'https://api.example.test' },
    { getItem: () => JSON.stringify({ token: 'vault-token' }) },
    errorDom.document,
    async () => { throw new Error(loadError); },
  );
  await nextTask();
  assert.equal(errorDom.elements.get('docs-list').firstElementChild.textContent, loadError);
});