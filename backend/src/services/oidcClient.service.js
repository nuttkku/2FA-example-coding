import * as client from 'openid-client';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// One discovered Configuration per provider, cached for the process lifetime -
// discovery is a network round-trip we don't need to repeat per login attempt.
const configCache = new Map();

async function getConfig(provider) {
  if (configCache.has(provider.id)) return configCache.get(provider.id);

  const server = new URL(provider.issuer);
  const discoveryOptions = provider.allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined;

  let config = await client.discovery(server, provider.clientId, provider.clientSecret, undefined, discoveryOptions);

  if (provider.publicIssuer) {
    // The backend reaches this issuer over an internal address (e.g. the
    // "keycloak" service name inside the docker-compose network), but the
    // browser must be redirected to a public address it can actually resolve.
    // token_endpoint/jwks_uri/userinfo_endpoint stay on the internal address
    // since only the backend calls those, server-to-server. "issuer" itself
    // also has to become the public origin: the authorization server reports
    // its issuer identity based on which address *that particular flow* was
    // reached through (RFC 9207's "iss" callback parameter, and the id_token's
    // own "iss" claim, both reflect the public address since the browser-driven
    // flow ran through it) - openid-client rejects the callback if the
    // configured issuer doesn't match that.
    const metadata = { ...config.serverMetadata() };
    const internalOrigin = server.origin;
    const publicOrigin = new URL(provider.publicIssuer).origin;

    for (const key of ['issuer', 'authorization_endpoint', 'end_session_endpoint']) {
      if (typeof metadata[key] === 'string' && metadata[key].startsWith(internalOrigin)) {
        metadata[key] = publicOrigin + metadata[key].slice(internalOrigin.length);
      }
    }

    config = new client.Configuration(metadata, provider.clientId, provider.clientSecret);
    if (provider.allowInsecure) client.allowInsecureRequests(config);
  }

  configCache.set(provider.id, config);
  return config;
}

export async function beginLogin(provider) {
  const config = await getConfig(provider);

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: provider.redirectUri,
    scope: provider.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    authorizationUrl: authorizationUrl.href,
    state: { provider: provider.id, state, nonce, codeVerifier },
  };
}

export async function completeLogin(provider, req, statePayload) {
  const config = await getConfig(provider);
  // Must be rebuilt against the public origin the browser actually used, not
  // req.protocol/req.get('host') - those reflect whatever host Vite's dev
  // proxy forwarded the request to internally (e.g. "backend:4000"), which
  // would silently produce a redirect_uri the identity provider never issued
  // the authorization code for, and every provider rejects the token exchange
  // outright when the two don't match byte-for-byte.
  const currentUrl = new URL(req.originalUrl, env.FRONTEND_ORIGIN);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    expectedState: statePayload.state,
    expectedNonce: statePayload.nonce,
    pkceCodeVerifier: statePayload.codeVerifier,
  });

  const idClaims = tokens.claims() ?? {};

  let userinfo = {};
  try {
    userinfo = await client.fetchUserInfo(config, tokens.access_token, idClaims.sub);
  } catch (err) {
    logger.warn(`[sso] ${provider.id} userinfo request failed, using ID token claims only: ${err.message}`);
  }

  const merged = { ...idClaims, ...userinfo };

  return {
    providerUserId: String(merged.sub),
    email: merged.email ?? null,
    emailVerified: Boolean(merged.email_verified),
    name: merged.name ?? merged.preferred_username ?? null,
  };
}
