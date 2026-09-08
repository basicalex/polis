import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { decodedEmailBodies } from './mail-codec.mjs';
import { assertOwnedRuntime, parseArgs } from './runtime-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const action = args.positional[0] ?? 'list';
const runtimePath = path.resolve(args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR ?? '');
if (!runtimePath) throw new Error('use --runtime <printed-runtime-path>');
const { paths } = await assertOwnedRuntime(runtimePath);
const capturePath = path.join(paths.mailDir, 'messages.ndjson');
let messages = [];
try {
  messages = (await readFile(capturePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

if (action === 'list') {
  // Bodies can contain login tokens. Listing is safe for shared terminals and logs.
  console.log(
    JSON.stringify(
      messages.map(({ id, capturedAt, from, to, bytes }) => ({ id, capturedAt, from, to, bytes })),
      null,
      2,
    ),
  );
} else if (action === 'show') {
  const id = args.value('id');
  if (!id) throw new Error('use inbox show --id <message-id>');
  const message = messages.find((entry) => entry.id === id);
  if (!message) throw new Error('captured message was not found');
  // Explicit operator action. Do not redirect this output into a shared log.
  // Decode quoted-printable/base64 bodies so wrapped fragment links remain usable.
  const bodies = decodedEmailBodies(message.data);
  process.stdout.write(`${bodies.join('\n\n')}\n`);
} else {
  throw new Error('inbox action must be list or show');
}
