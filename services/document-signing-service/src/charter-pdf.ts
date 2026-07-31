import type { SigningFieldPlacement } from './signing-provider.js';

// The PDF uses built-in Helvetica without font embedding. Latin text is
// transliterated deterministically; non-Latin scripts still cannot render.

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const TEXT_LINES_PER_PAGE = 44;
const SIGNERS_PER_PAGE = 2;
const encoder = new TextEncoder();

export interface MandateHolderDisplay {
  readonly displayName: string;
  readonly mandate?: string;
}

export interface CharterPdfResult {
  readonly pdf: Uint8Array;
  readonly fields: readonly SigningFieldPlacement[];
}

interface PdfPage {
  readonly content: string;
}

function printable(value: string): string {
  return value
    .replace(/[čć]/g, 'c')
    .replace(/[ČĆ]/g, 'C')
    .replace(/[đð]/g, 'd')
    .replace(/[ĐÐ]/g, 'D')
    .replace(/š/g, 's')
    .replace(/Š/g, 'S')
    .replace(/ž/g, 'z')
    .replace(/Ž/g, 'Z')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ß/g, 'ss')
    .replace(/þ/g, 'th')
    .replace(/Þ/g, 'TH')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function escapePdfText(value: string): string {
  return printable(value).replace(/([\\()])/g, '\\$1');
}

function wrapLine(value: string, width = 82): string[] {
  const source = printable(value).replace(/\s+/g, ' ').trim();
  if (source.length === 0) return [''];

  const lines: string[] = [];
  let remaining = source;
  while (remaining.length > width) {
    let split = remaining.lastIndexOf(' ', width);
    if (split <= 0) split = width;
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  lines.push(remaining);
  return lines;
}

function stableLines(value: unknown, path = 'charter'): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${path}: []`];
    return value.flatMap((entry, index) => stableLines(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) return [`${path}: {}`];
    return entries.flatMap(([key, entry]) => stableLines(entry, `${path}.${key}`));
  }
  if (typeof value === 'string') return wrapLine(`${path}: ${value}`);
  if (value === undefined) return [`${path}: undefined`];
  return [`${path}: ${JSON.stringify(value)}`];
}

function textPage(lines: readonly string[], pageNumber: number): PdfPage {
  const commands = [
    'BT',
    '/F1 16 Tf',
    '72 744 Td',
    `(${escapePdfText(pageNumber === 1 ? 'Polis Charter' : `Polis Charter - page ${pageNumber}`)}) Tj`,
    '/F1 10 Tf',
    '0 -28 Td',
  ];
  for (const line of lines) {
    commands.push(`(${escapePdfText(line)}) Tj`, '0 -14 Td');
  }
  commands.push('ET');
  return { content: `${commands.join('\n')}\n` };
}

function toPercent(value: number, total: number): number {
  return Number(((value / total) * 100).toFixed(4));
}

function signaturePages(
  holders: readonly MandateHolderDisplay[],
  firstPageNumber: number,
): { pages: PdfPage[]; fields: SigningFieldPlacement[] } {
  const pages: PdfPage[] = [];
  const fields: SigningFieldPlacement[] = [];

  for (let offset = 0; offset < holders.length; offset += SIGNERS_PER_PAGE) {
    const pageNumber = firstPageNumber + pages.length;
    const commands = [
      'BT',
      '/F1 16 Tf',
      '72 744 Td',
      '(Mandate-holder signatures) Tj',
      '/F1 9 Tf',
      '0 -24 Td',
      '(Signature and date fields below are reserved for the signing provider.) Tj',
      'ET',
    ];

    for (let slot = 0; slot < SIGNERS_PER_PAGE; slot += 1) {
      const recipientIndex = offset + slot;
      const holder = holders[recipientIndex];
      if (holder === undefined) break;

      const signatureX = 72;
      const signatureY = slot === 0 ? 520 : 280;
      const signatureWidth = 300;
      const signatureHeight = 72;
      const dateX = 402;
      const dateY = signatureY;
      const dateWidth = 138;
      const dateHeight = 72;
      const label = holder.mandate
        ? `${holder.displayName} - ${holder.mandate}`
        : holder.displayName;

      commands.push(
        'BT',
        '/F1 11 Tf',
        `${signatureX} ${signatureY + signatureHeight + 18} Td`,
        `(${escapePdfText(label)}) Tj`,
        'ET',
        `${signatureX} ${signatureY} ${signatureWidth} ${signatureHeight} re S`,
        `${dateX} ${dateY} ${dateWidth} ${dateHeight} re S`,
        'BT',
        '/F1 9 Tf',
        `${signatureX + 6} ${signatureY + 6} Td`,
        '(Signature) Tj',
        'ET',
        'BT',
        '/F1 9 Tf',
        `${dateX + 6} ${dateY + 6} Td`,
        '(Date) Tj',
        'ET',
      );

      fields.push(
        {
          recipientIndex,
          type: 'signature',
          page: pageNumber,
          x: toPercent(signatureX, PAGE_WIDTH),
          y: toPercent(PAGE_HEIGHT - signatureY - signatureHeight, PAGE_HEIGHT),
          width: toPercent(signatureWidth, PAGE_WIDTH),
          height: toPercent(signatureHeight, PAGE_HEIGHT),
        },
        {
          recipientIndex,
          type: 'date',
          page: pageNumber,
          x: toPercent(dateX, PAGE_WIDTH),
          y: toPercent(PAGE_HEIGHT - dateY - dateHeight, PAGE_HEIGHT),
          width: toPercent(dateWidth, PAGE_WIDTH),
          height: toPercent(dateHeight, PAGE_HEIGHT),
        },
      );
    }

    pages.push({ content: `${commands.join('\n')}\n` });
  }

  return { pages, fields };
}

function assemblePdf(pages: readonly PdfPage[]): Uint8Array {
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    if (pageId === undefined) throw new Error('PDF page object allocation failed');
    const contentId = pageId + 1;
    const contentLength = encoder.encode(page.content).byteLength;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(contentId, `<< /Length ${contentLength} >>\nstream\n${page.content}endstream`);
  });

  const objectCount = objects.size;
  const chunks: string[] = ['%PDF-1.4\n%Polis\n'];
  const offsets = [0];
  let byteOffset = encoder.encode(chunks[0]).byteLength;
  for (let id = 1; id <= objectCount; id += 1) {
    const body = objects.get(id);
    if (body === undefined) throw new Error(`Missing PDF object ${id}`);
    offsets[id] = byteOffset;
    const chunk = `${id} 0 obj\n${body}\nendobj\n`;
    chunks.push(chunk);
    byteOffset += encoder.encode(chunk).byteLength;
  }

  const xrefOffset = byteOffset;
  const xref = [
    'xref',
    `0 ${objectCount + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objectCount + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(xref);
  return encoder.encode(chunks.join(''));
}

export function renderCharterPdf(
  charter: Readonly<Record<string, unknown>>,
  mandateHolders: readonly MandateHolderDisplay[],
): CharterPdfResult {
  if (mandateHolders.length === 0) {
    throw new TypeError('At least one mandate holder is required');
  }

  const lines = stableLines(charter);
  const pages: PdfPage[] = [];
  for (let offset = 0; offset < lines.length; offset += TEXT_LINES_PER_PAGE) {
    pages.push(textPage(lines.slice(offset, offset + TEXT_LINES_PER_PAGE), pages.length + 1));
  }
  if (pages.length === 0) pages.push(textPage([], 1));

  const signatures = signaturePages(mandateHolders, pages.length + 1);
  pages.push(...signatures.pages);
  return { pdf: assemblePdf(pages), fields: signatures.fields };
}
