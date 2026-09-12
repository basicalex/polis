// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createTransport } from 'nodemailer';

import {
  magicLinkDeliveryMode,
  parseBoolean,
  publicAppOrigin,
  type IdentityEnvironment,
  type MagicLinkDeliveryMode,
} from './config.js';

export type MagicLinkMessage = {
  to: string;
  loginUrl: string;
  expiresAt: Date;
};

export interface MagicLinkDelivery {
  readonly mode: MagicLinkDeliveryMode;
  verify(): Promise<void>;
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

type MailTransport = {
  verify(): Promise<unknown>;
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

type TransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}) => MailTransport;

export type SmtpDeliveryConfig = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  useTls: boolean;
  useSsl: boolean;
  publicAppOrigin: string;
};

function requiredSingleLine(env: IdentityEnvironment, name: string, maximumLength: number): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when IDENTITY_MAGIC_LINK_DELIVERY=smtp`);
  if (value.length > maximumLength || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function smtpDeliveryConfig(env: IdentityEnvironment = process.env): SmtpDeliveryConfig {
  const host = requiredSingleLine(env, 'SMTP_HOST', 253);
  const rawPort = requiredSingleLine(env, 'SMTP_PORT', 5);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  const from = requiredSingleLine(env, 'SMTP_FROM', 320);
  if (!from.includes('@')) throw new Error('SMTP_FROM must contain an email address');

  const user = env.SMTP_USER?.trim() || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  if ((user && !password) || (!user && password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  }
  if (user && /[\r\n\0]/.test(user)) throw new Error('SMTP_USER is invalid');
  if (password && /[\r\n\0]/.test(password)) throw new Error('SMTP_PASSWORD is invalid');

  const useTls = parseBoolean(env, 'SMTP_USE_TLS');
  const useSsl = parseBoolean(env, 'SMTP_USE_SSL');
  if (useTls && useSsl) {
    throw new Error('SMTP_USE_TLS and SMTP_USE_SSL cannot both be true');
  }

  return {
    host,
    port,
    user,
    password,
    from,
    useTls,
    useSsl,
    publicAppOrigin: publicAppOrigin(env),
  };
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function magicLinkUrl(origin: string, email: string, token: string): string {
  const url = new URL('/pilot/vrsar/login', origin);
  url.hash = new URLSearchParams({ email, token }).toString();
  return url.toString();
}

export function createSmtpMagicLinkDelivery(
  config: SmtpDeliveryConfig,
  transportFactory: TransportFactory = (options) =>
    createTransport(options) as unknown as MailTransport,
): MagicLinkDelivery {
  const transport = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.useSsl,
    requireTLS: config.useTls,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });

  return {
    mode: 'smtp',
    async verify() {
      try {
        await transport.verify();
      } catch {
        throw new Error('SMTP_UNAVAILABLE');
      }
    },
    async sendMagicLink(message) {
      const subject = 'Sign in to Polis';
      const expiry = message.expiresAt.toISOString();
      const text = [
        'Use this private link to sign in to the Polis Vrsar pilot:',
        '',
        message.loginUrl,
        '',
        `The link expires at ${expiry}. If you did not request it, ignore this email.`,
      ].join('\n');
      const safeUrl = htmlEscape(message.loginUrl);
      const safeExpiry = htmlEscape(expiry);
      const html = [
        '<p>Use this private link to sign in to the Polis Vrsar pilot:</p>',
        `<p><a href="${safeUrl}">Sign in to Polis</a></p>`,
        `<p>The link expires at ${safeExpiry}. If you did not request it, ignore this email.</p>`,
      ].join('');
      try {
        await transport.sendMail({
          from: config.from,
          to: message.to,
          subject,
          text,
          html,
        });
      } catch {
        throw new Error('SMTP_DELIVERY_FAILED');
      }
    },
  };
}

const devDelivery: MagicLinkDelivery = {
  mode: 'dev',
  async verify() {},
  async sendMagicLink() {},
};

export function createMagicLinkDelivery(
  env: IdentityEnvironment = process.env,
  transportFactory?: TransportFactory,
): MagicLinkDelivery {
  if (magicLinkDeliveryMode(env) === 'dev') return devDelivery;
  return createSmtpMagicLinkDelivery(smtpDeliveryConfig(env), transportFactory);
}
