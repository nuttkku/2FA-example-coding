import crypto from 'node:crypto';
import { UnauthorizedError } from '../utils/errors.js';

// Facebook Login is plain OAuth 2.0, not OpenID Connect - there is no discovery
// document and no id_token, so unlike the other providers this can't go through
// the generic openid-client based flow and is implemented by hand against the
// Graph API's three well-documented HTTP calls.
const GRAPH_API_VERSION = 'v21.0';
const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;
const TOKEN_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`;
const PROFILE_URL = `https://graph.facebook.com/me`;

export async function beginLogin(provider) {
  const state = crypto.randomBytes(32).toString('hex');

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', provider.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'email,public_profile');
  url.searchParams.set('response_type', 'code');

  return {
    authorizationUrl: url.href,
    state: { provider: provider.id, state },
  };
}

export async function completeLogin(provider, req, statePayload) {
  if (!req.query.state || req.query.state !== statePayload.state) {
    throw new UnauthorizedError('Login attempt expired, please try again');
  }
  if (typeof req.query.code !== 'string') {
    throw new UnauthorizedError('Facebook did not return an authorization code');
  }

  const tokenUrl = new URL(TOKEN_URL);
  tokenUrl.searchParams.set('client_id', provider.clientId);
  tokenUrl.searchParams.set('client_secret', provider.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', provider.redirectUri);
  tokenUrl.searchParams.set('code', req.query.code);

  const tokenRes = await fetch(tokenUrl, { method: 'GET' });
  if (!tokenRes.ok) {
    throw new Error(`Facebook token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token: accessToken } = await tokenRes.json();

  const profileUrl = new URL(PROFILE_URL);
  profileUrl.searchParams.set('fields', 'id,name,email');
  profileUrl.searchParams.set('access_token', accessToken);

  const profileRes = await fetch(profileUrl, { method: 'GET' });
  if (!profileRes.ok) {
    throw new Error(`Facebook profile request failed: ${profileRes.status} ${await profileRes.text()}`);
  }
  const profile = await profileRes.json();

  return {
    providerUserId: String(profile.id),
    // The Graph API only ever returns this field for addresses it has verified
    // and the app was granted permission to read, so its mere presence implies
    // verified - unlike a generic OIDC claim there is no separate flag to check.
    email: profile.email ?? null,
    emailVerified: Boolean(profile.email),
    name: profile.name ?? null,
  };
}
