// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TraceStore } from './types.js';

type ChannelMethodName =
  | 'createChannelCase'
  | 'appendChannelMessage'
  | 'listOutbox'
  | 'markOutboxDelivery'
  | 'readFilerCase'
  | 'appendFilerMessage'
  | 'listMessages'
  | 'postOfficialMessage'
  | 'proposeAi'
  | 'decideAi'
  | 'closeCase'
  | 'listPublicShells'
  | 'getPublicCase'
  | 'recordAttention';

type ChannelMethods = Pick<TraceStore, ChannelMethodName>;

declare module './repository.js' {
  interface TraceRepository extends ChannelMethods {}
}

export const notImplementedChannelMethods: ChannelMethods = {
  async createChannelCase() {
    throw new Error('not_implemented');
  },
  async appendChannelMessage() {
    throw new Error('not_implemented');
  },
  async listOutbox() {
    throw new Error('not_implemented');
  },
  async markOutboxDelivery() {
    throw new Error('not_implemented');
  },
  async readFilerCase() {
    throw new Error('not_implemented');
  },
  async appendFilerMessage() {
    throw new Error('not_implemented');
  },
  async listMessages() {
    throw new Error('not_implemented');
  },
  async postOfficialMessage() {
    throw new Error('not_implemented');
  },
  async proposeAi() {
    throw new Error('not_implemented');
  },
  async decideAi() {
    throw new Error('not_implemented');
  },
  async closeCase() {
    throw new Error('not_implemented');
  },
  async listPublicShells() {
    throw new Error('not_implemented');
  },
  async getPublicCase() {
    throw new Error('not_implemented');
  },
  async recordAttention() {
    throw new Error('not_implemented');
  },
};
