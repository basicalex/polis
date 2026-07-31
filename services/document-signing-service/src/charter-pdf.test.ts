import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCharterPdf } from './charter-pdf.js';

const holders = [
  { displayName: 'Ada (Chair)', mandate: 'Governance' },
  { displayName: 'Linus \\ Reviewer', mandate: 'Technical' },
] as const;

test('charter PDF is deterministic and orders object keys', () => {
  const first = renderCharterPdf({ zeta: 2, alpha: 'first' }, holders);
  const second = renderCharterPdf({ alpha: 'first', zeta: 2 }, holders);

  assert.deepEqual(first.pdf, second.pdf);
  const text = Buffer.from(first.pdf).toString('ascii');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.indexOf('charter.alpha: first') < text.indexOf('charter.zeta: 2'));
  assert.ok(text.includes('Ada \\(Chair\\)'));
  assert.ok(text.includes('Linus \\\\ Reviewer'));
});

test('charter PDF transliterates Croatian Latin text readably', () => {
  const result = renderCharterPdf(
    { title: 'Vijeće Grada Zagreba', duty: 'Čuva javni interes i odlučuje pažljivo; déjà Noël u Łódźu uz smørrebrød' },
    [{ displayName: 'Željko Đurić', mandate: 'Vijećnik' }],
  );
  const text = Buffer.from(result.pdf).toString('ascii');
  assert.match(text, /Vijece Grada Zagreba/);
  assert.match(text, /Cuva javni interes i odlucuje pazljivo/);
  assert.match(text, /Zeljko Duric - Vijecnik/);
  assert.match(text, /deja Noel u Lodzu uz[\s\S]*smorrebrod/);
  assert.doesNotMatch(text, /\?/);
});

test('charter PDF has valid xref offsets and trailer position', () => {
  const { pdf } = renderCharterPdf({ purpose: 'A signed charter' }, holders);
  const text = Buffer.from(pdf).toString('ascii');
  const startXrefMatch = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  assert.ok(startXrefMatch);
  const xrefOffset = Number(startXrefMatch[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');

  const xrefMatch = /xref\n0 (\d+)\n([\s\S]*?)\ntrailer/.exec(text);
  assert.ok(xrefMatch);
  const size = Number(xrefMatch[1]);
  const rows = xrefMatch[2].split('\n');
  assert.equal(rows.length, size);
  for (let id = 1; id < size; id += 1) {
    const row = rows[id];
    assert.ok(row);
    const offset = Number(row.slice(0, 10));
    assert.equal(text.slice(offset, offset + String(id).length + 6), `${id} 0 obj`);
  }
});

test('charter PDF wraps across pages and exports final-page signature fields', () => {
  const sections = Array.from({ length: 100 }, (_, index) => `Section ${index} ${'word '.repeat(20)}`);
  const result = renderCharterPdf({ sections }, holders);
  const text = Buffer.from(result.pdf).toString('ascii');
  const pageCount = Number(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(text)?.[1]);

  assert.ok(pageCount >= 5);
  assert.equal(result.fields.length, holders.length * 2);
  assert.ok(result.fields.every((field) => field.page === pageCount));
  assert.ok(
    result.fields.every(
      (field) =>
        field.x >= 0 &&
        field.y >= 0 &&
        field.width > 0 &&
        field.height > 0 &&
        field.x + field.width <= 100.0001 &&
        field.y + field.height <= 100.0001,
    ),
  );
  assert.match(text, /Signature\) Tj/);
  assert.match(text, /Date\) Tj/);
  assert.ok((text.match(/ re S/g) ?? []).length >= 4);
});

test('charter PDF requires a mandate holder for signature placement', () => {
  assert.throws(() => renderCharterPdf({ title: 'No signer' }, []), /mandate holder/);
});
