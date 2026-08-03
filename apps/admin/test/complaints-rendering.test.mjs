import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagePath = new URL('../src/pages/complaints.astro', import.meta.url);

function createDom() {
  const created = [];
  const textAssignments = [];

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.attributes = new Map();
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      created.push(this);
    }

    set textContent(value) {
      this._textContent = String(value);
      textAssignments.push(this._textContent);
    }

    get textContent() {
      return this._textContent ?? '';
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

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    get childElementCount() {
      return this.children.filter((child) => child instanceof Element).length;
    }
  }

  const elements = new Map(
    [
      'complaints-queue',
      'queue-summary',
      'complaint-detail',
      'complaints-gate',
      'complaints-gate-message',
      'complaints-app',
      'refresh-queue',
    ].map((id) => [
      id,
      new Element(id === 'complaints-queue' ? 'tbody' : id === 'refresh-queue' ? 'button' : 'div'),
    ]),
  );

  return {
    Element,
    textAssignments,
    elements,
    document: {
      createElement: (tagName) => new Element(tagName),
      createTextNode: (text) => String(text),
      getElementById: (id) => elements.get(id),
    },
  };
}

function descendants(root) {
  const found = [];
  for (const child of root.children ?? []) {
    if (child && typeof child === 'object' && 'tagName' in child) {
      found.push(child, ...descendants(child));
    }
  }
  return found;
}

async function flushTasks(rounds = 8) {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('complaints workbench renders hostile queue/detail values as text and binds assignment', async () => {
  const page = await readFile(pagePath, 'utf8');
  const script = page.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'complaints client script is present');
  assert.doesNotMatch(page, /\.innerHTML\s*=/);
  assert.doesNotMatch(page, /onclick\s*=/);

  const hostile = {
    caseNumber: '<img src=x onerror=alert(1)>',
    subject: '<script>alert(2)</script>',
    narrative: '<svg onload=alert(3)>',
    question: '<button onclick=alert(4)>Question</button>',
    response: '<a href=javascript:alert(5)>Response</a>',
    reason: '<iframe srcdoc="<script>alert(6)</script>"></iframe>',
    grounds: '<math href=javascript:alert(7)>Grounds</math>',
    actor: '<input autofocus onfocus=alert(8)>',
  };
  const complaintId = "case-' onclick='alert(9)";
  const summary = {
    id: complaintId,
    caseNumber: hostile.caseNumber,
    subject: hostile.subject,
    status: 'submitted',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
  const detail = {
    ...summary,
    institutionId: 'inst-complaints-office',
    processId: 'process-citizen-service-complaint',
    jurisdictionId: 'jur-croatia-local',
    assignedMandateHolderId: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    closedAt: null,
    narrative: hostile.narrative,
    informationRequests: [
      {
        question: hostile.question,
        response: hostile.response,
        dueAt: null,
        createdAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    decisions: [
      {
        kind: 'initial',
        outcome: 'upheld',
        reason: hostile.reason,
        decidedBy: 'holder-initial',
        decidedAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    appeal: {
      id: 'appeal-1',
      status: 'filed',
      grounds: hostile.grounds,
      filedAt: '2026-08-04T00:00:00.000Z',
      decidedAt: null,
    },
    events: [
      {
        eventType: 'submitted',
        fromStatus: null,
        toStatus: 'submitted',
        occurredAt: '2026-08-04T00:00:00.000Z',
        actorId: hostile.actor,
      },
    ],
  };

  const { document, elements, textAssignments } = createDom();
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ status: 'assigned' }) };
    }
    if (url.endsWith('/api/v1/complaints/queue')) {
      return { ok: true, status: 200, json: async () => ({ items: [summary] }) };
    }
    return { ok: true, status: 200, json: async () => detail };
  };

  class MockFormData {
    constructor(form) {
      this.form = form;
    }

    get(name) {
      return descendants(this.form).find((element) => element.name === name)?.value ?? null;
    }
  }

  const location = { href: 'https://admin.example.test/complaints', search: '' };
  const history = { replaceState() {} };
  let ready;
  const window = {
    __API_URL: 'https://api.example.test',
    addEventListener: (_type, callback) => {
      ready = callback;
    },
  };
  const sessionStorage = {
    getItem: () => JSON.stringify({ token: 'staff-token', identityLevel: 'staff' }),
  };

  new Function(
    'window',
    'document',
    'sessionStorage',
    'location',
    'history',
    'fetch',
    'FormData',
    script,
  )(window, document, sessionStorage, location, history, fetch, MockFormData);
  ready();
  await flushTasks();

  for (const value of Object.values(hostile)) {
    assert.ok(textAssignments.some((assigned) => assigned.includes(value)), `rendered ${value} as text`);
  }

  const detailRoot = elements.get('complaint-detail');
  const assignmentForm = descendants(detailRoot).find(
    (element) =>
      element.tagName === 'form' &&
      descendants(element).some(
        (child) =>
          child.tagName === 'h4' && child.textContent === 'Assign initial decision holder',
      ),
  );
  assert.ok(assignmentForm, 'submitted case renders the assignment form');
  const holderInput = descendants(assignmentForm).find(
    (element) => element.name === 'assignedMandateHolderId',
  );
  holderInput.value = 'mh-complaint-decision-officer-demo';
  await assignmentForm.listeners.get('submit')({ preventDefault() {} });

  assert.deepEqual(
    requests.find((request) => request.options.method === 'POST'),
    {
      url: `https://api.example.test/api/v1/complaints/${encodeURIComponent(complaintId)}/assign`,
      options: {
        method: 'POST',
        headers: {
          authorization: 'Bearer staff-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ assignedMandateHolderId: 'mh-complaint-decision-officer-demo' }),
      },
    },
  );
});

test('complaints workbench explains the full staff status workflow', async () => {
  const page = await readFile(pagePath, 'utf8');
  for (const status of [
    'Submitted',
    'Assigned',
    'Awaiting information',
    'Decided',
    'Appealed',
    'Closed',
  ]) {
    assert.match(page, new RegExp(status));
  }
  assert.match(page, /independent appeal officer/i);
  assert.match(page, /restricted case record/i);
  assert.match(page, /not the isolated public-read pilot/i);
});
