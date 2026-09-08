import { appendFile, chmod, mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { parseArgs, safeEqualString } from './runtime-lib.mjs';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 8 * 1024;
const args = parseArgs(process.argv.slice(2));
const port = Number(args.value('port'));
const mailDir = args.value('mail-dir');
const allowedRecipients = new Set(
  JSON.parse(args.value('allowed-recipients') ?? '[]').map((entry) => String(entry).toLowerCase()),
);
const smtpUser = process.env.PILOT_SMTP_CAPTURE_USER;
const smtpPassword = process.env.PILOT_SMTP_CAPTURE_PASSWORD;

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !mailDir ||
  allowedRecipients.size === 0 ||
  !smtpUser ||
  !smtpPassword
) {
  throw new Error(
    'smtp capture requires a port, mail directory, allowlist, and private credentials',
  );
}
await mkdir(mailDir, { recursive: true, mode: 0o700 });
const captureFile = path.join(mailDir, 'messages.ndjson');

function reply(socket, line) {
  socket.write(`${line}\r\n`);
}

function addressFrom(argument) {
  const match = argument.match(/^<([^<>\s]+)>$/i);
  return match ? match[1].toLowerCase() : null;
}

function remoteIsLoopback(socket) {
  return socket.remoteAddress === '127.0.0.1' || socket.remoteAddress === '::ffff:127.0.0.1';
}

function plainCredentials(encoded) {
  try {
    const parts = Buffer.from(encoded, 'base64').toString('utf8').split('\0');
    return parts.length === 3 ? { user: parts[1], password: parts[2] } : null;
  } catch {
    return null;
  }
}

function validCredentials(user, password) {
  return safeEqualString(user, smtpUser) && safeEqualString(password, smtpPassword);
}

async function capture(message) {
  const line = `${JSON.stringify(message)}\n`;
  await appendFile(captureFile, line, { mode: 0o600 });
  await chmod(captureFile, 0o600);
}

const server = net.createServer((socket) => {
  if (!remoteIsLoopback(socket)) {
    socket.destroy();
    return;
  }
  let buffer = Buffer.alloc(0);
  let authenticated = false;
  let authStage = null;
  let mailFrom = null;
  let recipients = [];
  let collectingData = false;
  let dataLines = [];
  let dataBytes = 0;

  reply(socket, '220 polis pilot local SMTP capture');
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_MESSAGE_BYTES + MAX_LINE_BYTES) {
      reply(socket, '552 message too large');
      socket.destroy();
      return;
    }
    while (true) {
      const ending = buffer.indexOf('\r\n');
      if (ending === -1) break;
      const raw = buffer.subarray(0, ending);
      buffer = buffer.subarray(ending + 2);
      if (raw.length > MAX_LINE_BYTES) {
        reply(socket, '500 line too long');
        socket.destroy();
        return;
      }
      const line = raw.toString('utf8');
      if (collectingData) {
        if (line === '.') {
          collectingData = false;
          const message = dataLines.join('\r\n');
          void capture({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            capturedAt: new Date().toISOString(),
            from: mailFrom,
            to: recipients,
            bytes: Buffer.byteLength(message),
            data: message,
          })
            .then(() => reply(socket, '250 message captured'))
            .catch(() => {
              reply(socket, '451 local capture failure');
            });
          mailFrom = null;
          recipients = [];
          dataLines = [];
          dataBytes = 0;
          continue;
        }
        const value = line.startsWith('..') ? line.slice(1) : line;
        dataBytes += Buffer.byteLength(value) + 2;
        if (dataBytes > MAX_MESSAGE_BYTES) {
          collectingData = false;
          dataLines = [];
          reply(socket, '552 message too large');
          continue;
        }
        dataLines.push(value);
        continue;
      }
      if (authStage === 'login-user') {
        let user = '';
        try {
          user = Buffer.from(line, 'base64').toString('utf8');
        } catch {
          /* reply below */
        }
        if (!user) {
          authStage = null;
          reply(socket, '535 authentication failed');
        } else {
          authStage = { user };
          reply(socket, '334 UGFzc3dvcmQ6');
        }
        continue;
      }
      if (authStage && typeof authStage === 'object') {
        let password = '';
        try {
          password = Buffer.from(line, 'base64').toString('utf8');
        } catch {
          /* reply below */
        }
        authenticated = Boolean(password && validCredentials(authStage.user, password));
        authStage = null;
        reply(socket, authenticated ? '235 authenticated' : '535 authentication failed');
        continue;
      }
      const [verb = '', ...rest] = line.split(' ');
      const argument = rest.join(' ').trim();
      switch (verb.toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          reply(socket, '250-localhost');
          reply(socket, '250-AUTH PLAIN LOGIN');
          reply(socket, `250 SIZE ${MAX_MESSAGE_BYTES}`);
          break;
        case 'AUTH': {
          const [mechanism = '', payload = ''] = argument.split(/\s+/, 2);
          if (mechanism.toUpperCase() === 'PLAIN') {
            const credentials = plainCredentials(payload);
            authenticated = Boolean(
              credentials && validCredentials(credentials.user, credentials.password),
            );
            reply(socket, authenticated ? '235 authenticated' : '535 authentication failed');
          } else if (mechanism.toUpperCase() === 'LOGIN' && !payload) {
            authStage = 'login-user';
            reply(socket, '334 VXNlcm5hbWU6');
          } else {
            reply(socket, '504 unsupported authentication method');
          }
          break;
        }
        case 'MAIL': {
          if (!authenticated) {
            reply(socket, '530 authentication required');
            break;
          }
          const match = argument.match(/^FROM:\s*(.+)$/i);
          const sender = match ? addressFrom(match[1]) : null;
          if (!sender) {
            reply(socket, '501 invalid sender');
            break;
          }
          mailFrom = sender;
          recipients = [];
          reply(socket, '250 sender accepted');
          break;
        }
        case 'RCPT': {
          if (!mailFrom) {
            reply(socket, '503 MAIL FROM required');
            break;
          }
          const match = argument.match(/^TO:\s*(.+)$/i);
          const recipient = match ? addressFrom(match[1]) : null;
          if (!recipient || !allowedRecipients.has(recipient)) {
            reply(socket, '550 recipient rejected');
            break;
          }
          if (!recipients.includes(recipient)) recipients.push(recipient);
          reply(socket, '250 recipient accepted');
          break;
        }
        case 'DATA':
          if (!mailFrom || recipients.length === 0) reply(socket, '503 valid recipient required');
          else {
            collectingData = true;
            dataLines = [];
            dataBytes = 0;
            reply(socket, '354 end data with <CR><LF>.<CR><LF>');
          }
          break;
        case 'RSET':
          mailFrom = null;
          recipients = [];
          collectingData = false;
          dataLines = [];
          reply(socket, '250 reset');
          break;
        case 'NOOP':
          reply(socket, '250 ok');
          break;
        case 'QUIT':
          reply(socket, '221 bye');
          socket.end();
          break;
        default:
          reply(socket, '502 command not implemented');
      }
    }
  });
});

server.listen({ host: '127.0.0.1', port, exclusive: true });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
