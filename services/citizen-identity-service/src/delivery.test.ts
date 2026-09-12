// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import test from 'node:test';

import {
  createMagicLinkDelivery,
  createSmtpMagicLinkDelivery,
  magicLinkUrl,
  smtpDeliveryConfig,
} from './delivery.js';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function capturedLoopbackRelay(): Promise<{
  server: Server;
  port: number;
  messages: string[];
}> {
  const messages: string[] = [];
  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP test-relay\r\n');
    let buffer = '';
    let readingData = false;

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (buffer) {
        if (readingData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          readingData = false;
          socket.write('250 2.0.0 captured\r\n');
          continue;
        }

        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.split(' ', 1)[0]?.toUpperCase();
        if (command === 'EHLO') socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (command === 'HELO') socket.write('250 localhost\r\n');
        else if (command === 'DATA') {
          readingData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 2.0.0 bye\r\n');
        } else {
          socket.write('250 2.0.0 ok\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port, messages };
}

test('magic-link URL keeps credentials in the fragment on the configured origin', () => {
  const rawToken = 'synthetic-token-not-a-real-credential';
  const link = magicLinkUrl('https://pilot.example', 'resident@example.test', rawToken);
  const parsed = new URL(link);
  assert.equal(parsed.origin, 'https://pilot.example');
  assert.equal(parsed.pathname, '/pilot/vrsar/login');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, `#email=resident%40example.test&token=${rawToken}`);
});

test('SMTP adapter delivers only to a captured loopback relay with the expected payload', async () => {
  const relay = await capturedLoopbackRelay();
  try {
    const env = {
      IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
      PUBLIC_APP_URL: 'http://127.0.0.1:4321/ignored/path',
      IDENTITY_ALLOW_HTTP_LOCALHOST: 'true',
      NODE_ENV: 'test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(relay.port),
      SMTP_FROM: 'Polis Test <noreply@example.test>',
      SMTP_USE_TLS: 'false',
      SMTP_USE_SSL: 'false',
    };
    const delivery = createMagicLinkDelivery(env);
    await delivery.verify();
    const loginUrl = magicLinkUrl(
      smtpDeliveryConfig(env).publicAppOrigin,
      'resident@example.test',
      'captured-synthetic-token',
    );
    await delivery.sendMagicLink({
      to: 'resident@example.test',
      loginUrl,
      expiresAt: new Date('2026-09-05T12:15:00.000Z'),
    });

    assert.equal(relay.messages.length, 1);
    const message = relay.messages[0]!;
    assert.match(message, /Subject: Sign in to Polis/);
    assert.match(message, /To: resident@example\.test/);
    assert.match(message, /\/pilot\/vrsar\/login/);
    assert.match(message, /captured-synthetic-token/);
    assert.doesNotMatch(message, /\?email=/);
  } finally {
    await closeServer(relay.server);
  }
});

test('SMTP adapter replaces transport failures with safe stable errors', async () => {
  const sensitive = 'resident@example.test captured-synthetic-token';
  const config = {
    host: '127.0.0.1',
    port: 1025,
    from: 'noreply@example.test',
    useTls: false,
    useSsl: false,
    publicAppOrigin: 'http://127.0.0.1:4321',
  };
  const delivery = createSmtpMagicLinkDelivery(config, () => ({
    async verify() {
      throw new Error(sensitive);
    },
    async sendMail() {
      throw new Error(sensitive);
    },
  }));

  await assert.rejects(delivery.verify(), (error: Error) => {
    assert.equal(error.message, 'SMTP_UNAVAILABLE');
    assert.doesNotMatch(error.message, /resident|token/);
    return true;
  });
  await assert.rejects(
    delivery.sendMagicLink({
      to: 'resident@example.test',
      loginUrl: 'http://127.0.0.1:4321/pilot/vrsar/login#token=hidden',
      expiresAt: new Date('2026-09-05T12:15:00.000Z'),
    }),
    (error: Error) => {
      assert.equal(error.message, 'SMTP_DELIVERY_FAILED');
      assert.doesNotMatch(error.message, /resident|token/);
      return true;
    },
  );
});

test('SMTP configuration fails closed and local HTTP needs an explicit nonproduction flag', () => {
  assert.throws(
    () => smtpDeliveryConfig({ IDENTITY_MAGIC_LINK_DELIVERY: 'smtp' }),
    /SMTP_HOST is required/,
  );
  const base = {
    IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM: 'noreply@example.test',
    SMTP_USE_TLS: 'false',
    SMTP_USE_SSL: 'false',
  };
  assert.throws(
    () => smtpDeliveryConfig({ ...base, PUBLIC_APP_URL: 'http://localhost:4321' }),
    /IDENTITY_ALLOW_HTTP_LOCALHOST=true/,
  );
  assert.throws(
    () =>
      smtpDeliveryConfig({
        ...base,
        PUBLIC_APP_URL: 'http://localhost:4321',
        IDENTITY_ALLOW_HTTP_LOCALHOST: 'true',
        NODE_ENV: 'production',
      }),
    /must use HTTPS/,
  );
  assert.doesNotThrow(() =>
    smtpDeliveryConfig({ ...base, PUBLIC_APP_URL: 'https://pilot.example' }),
  );
});
