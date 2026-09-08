import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_ATTACHMENT_BYTES,
  InputError,
  normalizeAttachment,
  normalizeCommitment,
  normalizeCreate,
  normalizeResolution,
  normalizeReview,
  parseListLimit,
  validateDateOnly,
  validateIdempotencyKey,
} from './validation.js';

const VALID_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWP4z8AAAAMBAQBb2/lEAAAAAElFTkSuQmCC',
  'base64',
);
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z',
  'base64',
);

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof InputError ? error.code : undefined;
  }
}

test('authority and unknown fields are rejected while SQL-shaped report text remains inert data', () => {
  assert.equal(
    code(() => normalizeCreate({ subject: 's', narrative: 'n', location: 'l', role: 'official' })),
    'authority_field_forbidden',
  );
  assert.equal(
    code(() => normalizeCreate({ subject: 's', narrative: 'n', location: 'l', extra: true })),
    'unknown_field',
  );
  assert.equal(
    normalizeCreate({ subject: "x'); DROP TABLE trace_records; --", narrative: 'n', location: 'l' })
      .subject,
    "x'); DROP TABLE trace_records; --",
  );
});

test('date-only validation rejects invalid syntax and impossible calendar dates', () => {
  assert.equal(validateDateOnly('2028-02-29'), '2028-02-29');
  for (const value of [
    '2026-2-01',
    '2026-02-29',
    '2026-13-01',
    '2026-04-31',
    '2026-01-01T00:00:00Z',
  ]) {
    assert.equal(
      code(() => validateDateOnly(value)),
      'invalid_due_date',
    );
  }
});

test('evidence URLs are bounded HTTPS-only values without credentials', () => {
  const valid = normalizeResolution({
    expectedVersion: 2,
    evidenceNote: 'Completed',
    evidenceUrls: ['https://example.test/proof'],
  });
  assert.deepEqual(valid.evidenceUrls, ['https://example.test/proof']);
  for (const url of ['http://example.test', 'https://user:pass@example.test', 'not-a-url']) {
    assert.equal(
      code(() =>
        normalizeResolution({ expectedVersion: 2, evidenceNote: 'Completed', evidenceUrls: [url] }),
      ),
      'invalid_evidence_urls',
    );
  }
  assert.equal(
    code(() =>
      normalizeResolution({ expectedVersion: 2, evidenceNote: 'Completed', evidenceUrls: [] }),
    ),
    'invalid_evidence_urls',
  );
});

test('review notes and optimistic versions are strict', () => {
  assert.equal(
    code(() => normalizeReview({ expectedVersion: 0, decision: 'return', note: '' })),
    'review_note_required',
  );
  assert.equal(
    code(() => normalizeReview({ expectedVersion: -1, decision: 'accept', note: null })),
    'invalid_expected_version',
  );
  assert.deepEqual(normalizeReview({ expectedVersion: 1, decision: 'accept', note: null }), {
    expectedVersion: 1,
    decision: 'accept',
    note: null,
  });
  assert.equal(
    code(() =>
      normalizeCommitment({
        expectedVersion: 1.5,
        publicSummary: 's',
        commitment: 'c',
        dueDate: '2026-10-01',
      }),
    ),
    'invalid_expected_version',
  );
});

test('uploads enforce type, filename, canonical base64, and decoded 2 MiB bound', () => {
  const valid = normalizeAttachment({
    expectedVersion: 0,
    filename: 'evidence.pdf',
    contentType: 'application/pdf',
    base64: VALID_PDF.toString('base64'),
  });
  assert.equal(valid.base64, VALID_PDF.toString('base64'));
  assert.doesNotThrow(() =>
    normalizeAttachment({
      expectedVersion: 0,
      filename: 'pixel.png',
      contentType: 'image/png',
      base64: VALID_PNG.toString('base64'),
    }),
  );
  assert.doesNotThrow(() =>
    normalizeAttachment({
      expectedVersion: 0,
      filename: 'pixel.jpg',
      contentType: 'image/jpeg',
      base64: VALID_JPEG.toString('base64'),
    }),
  );
  assert.doesNotThrow(() =>
    normalizeAttachment({
      expectedVersion: 0,
      filename: 'bilješka.txt',
      contentType: 'text/plain',
      base64: Buffer.from('Dovršeno u Vrsaru.\n', 'utf8').toString('base64'),
    }),
  );
  for (const filename of ['../secret', 'bad\\name', 'bad\nname']) {
    assert.equal(
      code(() =>
        normalizeAttachment({
          expectedVersion: 0,
          filename,
          contentType: 'text/plain',
          base64: 'YQ==',
        }),
      ),
      filename.includes('\n') ? 'invalid_request' : 'invalid_filename',
    );
  }
  assert.equal(
    code(() =>
      normalizeAttachment({
        expectedVersion: 0,
        filename: 'x.svg',
        contentType: 'image/svg+xml',
        base64: 'YQ==',
      }),
    ),
    'unsupported_attachment_type',
  );
  assert.equal(
    code(() =>
      normalizeAttachment({
        expectedVersion: 0,
        filename: 'x.svg',
        contentType: 'text/plain',
        base64: Buffer.from('<svg></svg>').toString('base64'),
      }),
    ),
    'invalid_filename',
  );
  for (const disguised of [
    {
      filename: 'fake.png',
      contentType: 'image/png',
      bytes: Buffer.from('not a png'),
    },
    {
      filename: 'fake.jpg',
      contentType: 'image/jpeg',
      bytes: VALID_PDF,
    },
    {
      filename: 'page.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('<html><script>alert(1)</script></html>'),
    },
    {
      filename: 'binary.txt',
      contentType: 'text/plain',
      bytes: Buffer.from([0xff, 0xfe, 0x00, 0x01]),
    },
    {
      filename: 'script.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('#!/bin/sh\necho unsafe\n'),
    },
  ]) {
    assert.equal(
      code(() =>
        normalizeAttachment({
          expectedVersion: 0,
          filename: disguised.filename,
          contentType: disguised.contentType,
          base64: disguised.bytes.toString('base64'),
        }),
      ),
      'attachment_content_mismatch',
    );
  }
  assert.equal(
    code(() =>
      normalizeAttachment({
        expectedVersion: 0,
        filename: 'x.txt',
        contentType: 'text/plain',
        base64: 'YQ=',
      }),
    ),
    'invalid_base64',
  );
  const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64');
  assert.equal(
    code(() =>
      normalizeAttachment({
        expectedVersion: 0,
        filename: 'x.txt',
        contentType: 'text/plain',
        base64: oversized,
      }),
    ),
    'invalid_attachment',
  );
});

test('idempotency UUIDs and list limits are bounded', () => {
  assert.equal(
    validateIdempotencyKey('10000000-0000-4000-8000-000000000001'),
    '10000000-0000-4000-8000-000000000001',
  );
  assert.equal(
    validateIdempotencyKey('10000000-0000-7000-8000-000000000001'),
    '10000000-0000-7000-8000-000000000001',
  );
  assert.equal(
    code(() => validateIdempotencyKey(undefined)),
    'idempotency_key_required',
  );
  assert.equal(
    code(() => validateIdempotencyKey('not-a-uuid')),
    'invalid_idempotency_key',
  );
  assert.equal(parseListLimit('/internal/trace/records'), 50);
  assert.equal(parseListLimit('/internal/trace/records?limit=100'), 100);
  assert.equal(
    code(() => parseListLimit('/internal/trace/records?limit=101')),
    'invalid_limit',
  );
  assert.equal(
    code(() => parseListLimit('/internal/trace/records?limit=1%20OR%201=1')),
    'invalid_limit',
  );
});
