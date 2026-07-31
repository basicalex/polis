import { createHash, createHmac } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { eq } from 'drizzle-orm';

export interface ArtifactPutMetadata {
  artifactId: string;
  sha256: string;
  mimeType?: string;
}

export interface ArtifactStore {
  readonly mode: 'database' | 's3';
  put(bytes: Uint8Array, metadata: ArtifactPutMetadata): Promise<string>;
  get(storageRef: string): Promise<Uint8Array>;
  exists(storageRef: string): Promise<boolean>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertHash(bytes: Uint8Array, expected: string): void {
  const actual = sha256Hex(bytes);
  if (actual !== expected) throw new Error('artifact_hash_mismatch');
}

function databaseRef(artifactId: string, sha256: string): string {
  return `database:${encodeURIComponent(artifactId)}:${sha256}`;
}

function parseDatabaseRef(ref: string): { artifactId: string; sha256: string } {
  const match = /^database:([^:]+):([a-f0-9]{64})$/.exec(ref);
  if (!match?.[1] || !match[2]) throw new Error('invalid_database_storage_ref');
  return { artifactId: decodeURIComponent(match[1]), sha256: match[2] };
}

export class DatabaseArtifactStore implements ArtifactStore {
  readonly mode = 'database' as const;

  constructor(private readonly db: DbClient) {}

  async put(bytes: Uint8Array, metadata: ArtifactPutMetadata): Promise<string> {
    assertHash(bytes, metadata.sha256);
    const content = Buffer.from(bytes);
    await this.db.insert(schema.documentArtifactBlobs).values({ artifactId: metadata.artifactId, content }).onConflictDoNothing();
    const ref = databaseRef(metadata.artifactId, metadata.sha256);
    const stored = await this.get(ref);
    assertHash(stored, metadata.sha256);
    return ref;
  }

  async get(storageRef: string): Promise<Uint8Array> {
    const parsed = parseDatabaseRef(storageRef);
    const rows = await this.db.select({ content: schema.documentArtifactBlobs.content }).from(schema.documentArtifactBlobs).where(eq(schema.documentArtifactBlobs.artifactId, parsed.artifactId)).limit(1);
    const content = rows[0]?.content;
    if (content === undefined) throw new Error('artifact_content_not_found');
    const bytes = Uint8Array.from(content);
    assertHash(bytes, parsed.sha256);
    return bytes;
  }

  async exists(storageRef: string): Promise<boolean> {
    const parsed = parseDatabaseRef(storageRef);
    const rows = await this.db.select({ artifactId: schema.documentArtifactBlobs.artifactId }).from(schema.documentArtifactBlobs).where(eq(schema.documentArtifactBlobs.artifactId, parsed.artifactId)).limit(1);
    return rows.length === 1;
  }
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface S3ArtifactStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle?: boolean;
  prefix?: string;
  serverSideEncryption?: string;
  maxDownloadBytes?: number;
  fetch?: FetchImplementation;
  now?: () => Date;
}

interface ParsedS3Ref {
  key: string;
  sha256: string;
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function s3Ref(key: string, sha256: string): string {
  return `s3:${Buffer.from(key, 'utf8').toString('base64url')}:${sha256}`;
}

function parseS3Ref(ref: string): ParsedS3Ref {
  const match = /^s3:([A-Za-z0-9_-]+):([a-f0-9]{64})$/.exec(ref);
  if (!match?.[1] || !match[2]) throw new Error('invalid_s3_storage_ref');
  return { key: Buffer.from(match[1], 'base64url').toString('utf8'), sha256: match[2] };
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export class S3ArtifactStore implements ArtifactStore {
  readonly mode = 's3' as const;
  readonly #endpoint: URL;
  readonly #region: string;
  readonly #bucket: string;
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #pathStyle: boolean;
  readonly #prefix: string;
  readonly #serverSideEncryption?: string;
  readonly #maxDownloadBytes: number;
  readonly #fetch: FetchImplementation;
  readonly #now: () => Date;

  constructor(config: S3ArtifactStoreConfig) {
    let endpoint: URL;
    try { endpoint = new URL(config.endpoint); } catch { throw new Error('S3_ARTIFACT_ENDPOINT is invalid'); }
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('S3_ARTIFACT_ENDPOINT is invalid');
    if (!config.region || !config.bucket || !config.accessKeyId || !config.secretAccessKey) throw new Error('S3 artifact configuration is incomplete');
    this.#endpoint = endpoint;
    this.#region = config.region;
    this.#bucket = config.bucket;
    this.#accessKeyId = config.accessKeyId;
    this.#secretAccessKey = config.secretAccessKey;
    this.#pathStyle = config.pathStyle ?? true;
    this.#prefix = (config.prefix ?? 'document-artifacts').replace(/^\/+|\/+$/g, '');
    this.#serverSideEncryption = config.serverSideEncryption;
    this.#maxDownloadBytes = config.maxDownloadBytes ?? 50 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#maxDownloadBytes) || this.#maxDownloadBytes <= 0) throw new Error('S3 artifact download limit is invalid');
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#now = config.now ?? (() => new Date());
  }

  async put(bytes: Uint8Array, metadata: ArtifactPutMetadata): Promise<string> {
    assertHash(bytes, metadata.sha256);
    const key = `${this.#prefix}/${metadata.artifactId}`;
    const headers: Record<string, string> = { 'content-type': metadata.mimeType ?? 'application/octet-stream' };
    if (this.#serverSideEncryption) headers['x-amz-server-side-encryption'] = this.#serverSideEncryption;
    const response = await this.#request('PUT', key, metadata.sha256, headers, bytes);
    if (!response.ok) throw new Error(`s3_put_failed:${response.status}`);
    return s3Ref(key, metadata.sha256);
  }

  async get(storageRef: string): Promise<Uint8Array> {
    const parsed = parseS3Ref(storageRef);
    const response = await this.#request('GET', parsed.key, EMPTY_SHA256);
    if (response.status === 404) throw new Error('artifact_content_not_found');
    if (!response.ok) throw new Error(`s3_get_failed:${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.#maxDownloadBytes) {
      await response.body?.cancel();
      throw new Error('artifact_content_too_large');
    }
    if (!response.body) {
      const empty = new Uint8Array();
      assertHash(empty, parsed.sha256);
      return empty;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > this.#maxDownloadBytes) {
        await reader.cancel();
        throw new Error('artifact_content_too_large');
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    assertHash(bytes, parsed.sha256);
    return bytes;
  }

  async exists(storageRef: string): Promise<boolean> {
    const parsed = parseS3Ref(storageRef);
    const response = await this.#request('HEAD', parsed.key, EMPTY_SHA256);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`s3_head_failed:${response.status}`);
    return true;
  }

  async #request(method: string, key: string, payloadHash: string, extraHeaders: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const now = this.#now();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const url = new URL(this.#endpoint);
    const encodedKey = encodeKey(key);
    if (this.#pathStyle) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(this.#bucket)}/${encodedKey}`;
    } else {
      url.hostname = `${this.#bucket}.${url.hostname}`;
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodedKey}`;
    }
    const headers: Record<string, string> = {
      ...extraHeaders,
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const canonicalHeaderNames = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = canonicalHeaderNames.map((name) => `${name}:${headers[name]?.trim().replace(/\s+/g, ' ') ?? ''}\n`).join('');
    const signedHeaders = canonicalHeaderNames.join(';');
    const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${this.#region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const dateKey = hmac(`AWS4${this.#secretAccessKey}`, date);
    const regionKey = hmac(dateKey, this.#region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return this.#fetch(url, { method, headers, body: body ? Uint8Array.from(body) : undefined });
  }
}

export interface ArtifactStoreEnvironment {
  ARTIFACT_STORE_MODE?: string;
  S3_ARTIFACT_ENDPOINT?: string;
  S3_ARTIFACT_REGION?: string;
  S3_ARTIFACT_BUCKET?: string;
  S3_ARTIFACT_ACCESS_KEY_ID?: string;
  S3_ARTIFACT_SECRET_ACCESS_KEY?: string;
  S3_ARTIFACT_PATH_STYLE?: string;
  S3_ARTIFACT_PREFIX?: string;
  S3_ARTIFACT_SERVER_SIDE_ENCRYPTION?: string;
}

export function createArtifactStore(db: DbClient, env: ArtifactStoreEnvironment = process.env): ArtifactStore {
  const mode = env.ARTIFACT_STORE_MODE ?? 'database';
  if (mode === 'database') return new DatabaseArtifactStore(db);
  if (mode !== 's3') throw new Error(`Unsupported ARTIFACT_STORE_MODE: ${mode}`);
  const required = [env.S3_ARTIFACT_ENDPOINT, env.S3_ARTIFACT_REGION, env.S3_ARTIFACT_BUCKET, env.S3_ARTIFACT_ACCESS_KEY_ID, env.S3_ARTIFACT_SECRET_ACCESS_KEY];
  if (required.some((value) => !value?.trim())) throw new Error('S3 artifact configuration is incomplete');
  return new S3ArtifactStore({
    endpoint: env.S3_ARTIFACT_ENDPOINT!,
    region: env.S3_ARTIFACT_REGION!,
    bucket: env.S3_ARTIFACT_BUCKET!,
    accessKeyId: env.S3_ARTIFACT_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_ARTIFACT_SECRET_ACCESS_KEY!,
    pathStyle: env.S3_ARTIFACT_PATH_STYLE !== 'false',
    prefix: env.S3_ARTIFACT_PREFIX,
    serverSideEncryption: env.S3_ARTIFACT_SERVER_SIDE_ENCRYPTION,
  });
}
