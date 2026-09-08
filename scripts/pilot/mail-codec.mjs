function headersAndBody(source) {
  const separator = source.search(/\r?\n\r?\n/);
  if (separator === -1) return { headers: '', body: source };
  const match = source.slice(separator).match(/^\r?\n\r?\n/);
  return { headers: source.slice(0, separator), body: source.slice(separator + match[0].length) };
}

function headerValue(headers, name) {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const match = unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

export function decodeTransferEncoding(body, encoding) {
  const normalized = encoding.toLowerCase();
  if (normalized === 'base64')
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (normalized === 'quoted-printable') {
    const joined = body.replace(/=\r?\n/g, '');
    const binary = joined.replace(/=([a-f0-9]{2})/gi, (_all, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    return Buffer.from(binary, 'latin1').toString('utf8');
  }
  return body;
}

export function decodedEmailBodies(source) {
  const { headers, body } = headersAndBody(source);
  const contentType = headerValue(headers, 'content-type');
  const boundary = contentType.match(/boundary\s*=\s*"?([^";\s]+)"?/i)?.[1];
  if (!boundary)
    return [decodeTransferEncoding(body, headerValue(headers, 'content-transfer-encoding'))];
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .slice(1)
    .map((part) => part.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
    .filter((part) => part && part !== '--')
    .flatMap((part) => decodedEmailBodies(part));
}
