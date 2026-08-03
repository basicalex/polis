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
      this.hidden = false;
      this.className = '';
    }

    set textContent(value) {
      this._textContent = String(value);
      textAssignments.push(this._textContent);
    }

    get textContent() {
      return this._textContent;
    }

    set innerHTML(_) {
      throw new Error('unsafe innerHTML rendering');
    }

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      this.children = children;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    setAttribute() {}
    querySelector() { return null; }
  }

  const ids = [
    'complaint-auth',
    'complaint-detail',
    'complaint-state',
    'complaint-announcement',
    'case-number',
    'case-heading',
    'case-status',
    'case-narrative',
    'information-requests',
    'decisions',
    'appeal',
    'owner-actions',
    'case-timeline',
  ];
  const elements = new Map(ids.map((id) => [id, new Element('div')]));
  return {
    document: {
      createElement: (tagName) => new Element(tagName),
      createTextNode: (value) => String(value),
      getElementById: (id) => elements.get(id),
    },
    textAssignments,
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('complaint detail renders hostile API values as text', async () => {
  const page = await readFile(new URL('../src/pages/complaints/[id].astro', import.meta.url), 'utf8');
  const script = page.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'complaint detail client script is present');
  assert.doesNotMatch(page, /\.innerHTML\s*=/);
  assert.doesNotMatch(page, /\.onclick\s*=/);

  const hostileValues = [
    '<img src=x onerror=alert(1)>',
    '<button onclick="alert(1)">Respond</button>',
    '<svg onload=alert(1)>',
    '<script>alert(1)</script>',
    '<a href=javascript:alert(1)>x</a>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<details open ontoggle=alert(1)>x</details>',
    '<math><mtext>unsafe</mtext></math>',
  ];
  const { document, textAssignments } = createDom();
  let ready;
  const window = {
    __API_URL: 'https://api.example.test',
    addEventListener: (_type, callback) => { ready = callback; },
  };
  const location = { pathname: '/complaints/case-123' };
  const detail = {
    id: 'case-123',
    caseNumber: hostileValues[0],
    subject: hostileValues[1],
    status: hostileValues[2],
    updatedAt: hostileValues[3],
    narrative: hostileValues[4],
    informationRequests: [{
      id: 'request-123',
      question: hostileValues[5],
      response: hostileValues[6],
      createdAt: hostileValues[7],
      dueAt: null,
      respondedAt: hostileValues[0],
    }],
    decisions: [{
      kind: hostileValues[1],
      outcome: hostileValues[2],
      reason: hostileValues[3],
      decidedAt: hostileValues[4],
    }],
    appeal: {
      status: hostileValues[5],
      grounds: hostileValues[6],
      filedAt: hostileValues[7],
      decidedAt: hostileValues[0],
    },
    events: [{
      eventType: hostileValues[1],
      fromStatus: hostileValues[2],
      toStatus: hostileValues[3],
      occurredAt: hostileValues[4],
    }],
  };
  const fetch = async () => ({ ok: true, status: 200, json: async () => detail });

  new Function('window', 'document', 'sessionStorage', 'location', 'fetch', script)(
    window,
    document,
    { getItem: () => JSON.stringify({ token: 'resident-token' }) },
    location,
    fetch,
  );
  ready();
  await settle();

  for (const value of hostileValues) {
    assert.ok(
      textAssignments.some((assignment) => assignment.includes(value)),
      `renders ${value} with textContent`,
    );
  }
});
