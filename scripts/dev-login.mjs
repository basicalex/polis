async function jsonRequest(base, path, init = {}) {
  const response = await fetch(base + path, init);
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

export async function loginCitizen(bffBase, email) {
  const magicLink = await jsonRequest(bffBase, '/api/v1/identity/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (magicLink.status !== 200) return { error: `magic-link ${magicLink.status}` };

  const devTokens = await jsonRequest(bffBase, '/api/v1/identity/dev-tokens');
  if (devTokens.status !== 200) return { error: `dev-tokens ${devTokens.status}` };
  const token = devTokens.body?.tokens?.[email];
  if (typeof token !== 'string') return { error: 'no dev token' };

  const exchange = await jsonRequest(bffBase, '/api/v1/identity/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, token }),
  });
  if (exchange.status !== 200) return { error: `exchange ${exchange.status}` };
  if (typeof exchange.body?.sessionToken !== 'string' || !exchange.body?.citizen) {
    return { error: 'invalid exchange response' };
  }
  return {
    sessionToken: exchange.body.sessionToken,
    citizen: exchange.body.citizen,
  };
}
