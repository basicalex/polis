import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function createDom() {
  const textAssignments = [];
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.style = {};
    }

    set textContent(value) {
      this._textContent = String(value);
      textAssignments.push(this._textContent);
    }

    get textContent() { return this._textContent; }
    set innerHTML(_) { throw new Error('unsafe innerHTML rendering'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
  }

  const elements = new Map([
    ['queue', new Element('tbody')],
    ['review-msg', new Element('p')],
  ]);
  return {
    document: {
      createElement: (tagName) => new Element(tagName),
      createTextNode: (text) => text,
      getElementById: (id) => elements.get(id),
    },
    elements,
    textAssignments,
  };
}

async function nextTask() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('review queue renders malicious API values as text and binds decisions', async () => {
  const review = await readFile(new URL('../src/pages/review.astro', import.meta.url), 'utf8');
  const script = review.match(/<script is:inline define:vars=\{\{ API \}\}>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'review client script is present');
  assert.doesNotMatch(review, /\.innerHTML\s*=/);
  assert.doesNotMatch(review, /\.onclick\s*=/);

  const hostileValues = [
    '<img src=x onerror=alert(1)>',
    '<button onclick="alert(1)">Approve</button>',
    '<svg onload=alert(1)>',
    '<script>alert(1)</script>',
    '<a href=javascript:alert(1)>x</a>',
  ];
  const submissionId = "submission-' onclick='alert(1)";
  const { document, elements, textAssignments } = createDom();
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200 };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: submissionId,
          type: hostileValues[0],
          contributionClass: hostileValues[1],
          contributorDisplayName: hostileValues[2],
          status: hostileValues[3],
          submittedAt: hostileValues[4],
        }],
      }),
    };
  };
  new Function('API', 'document', 'sessionStorage', 'location', 'fetch', script)(
    'https://api.example.test',
    document,
    { getItem: () => JSON.stringify({ token: 'staff-token' }) },
    {},
    fetch,
  );
  await nextTask();

  for (const value of hostileValues) assert.ok(textAssignments.includes(value));
  const actions = elements.get('queue').children[0].children[6];
  await actions.children[0].listeners.get('click')();
  assert.deepEqual(requests.find((request) => request.options.method === 'POST'), {
    url: `https://api.example.test/api/v1/review/${submissionId}/decide`,
    options: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer staff-token',
      },
      body: JSON.stringify({ decision: 'approve', notes: '' }),
    },
  });
});
