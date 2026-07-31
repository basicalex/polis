const internalApiToken = process.env.INTERNAL_API_TOKEN ?? 'polis-internal-dev-token';

export function withInternalHeaders(path, headers = {}) {
  if (!path.startsWith('/internal/')) return headers;
  return { ...headers, 'X-Polis-Internal-Token': internalApiToken };
}
