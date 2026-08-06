import { logger } from '../utils/logger.js';
import { env } from './env.js';

// Every SSO provider is optional and independently toggled - a missing or
// incomplete configuration disables just that provider (logged as a warning)
// rather than failing the whole app to boot, since these are pluggable
// integrations, unlike the core secrets validated in env.js.
function readBool(name) {
  return process.env[name] === 'true';
}

function readStr(name, defaultValue = '') {
  return process.env[name] ?? defaultValue;
}

function redirectUriFor(providerId) {
  return `${env.FRONTEND_ORIGIN}/api/auth/sso/${providerId}/callback`;
}

function disabled(id) {
  return { id, enabled: false };
}

function buildKeycloak() {
  const id = 'keycloak';
  if (!readBool('KEYCLOAK_ENABLED')) return disabled(id);

  const issuer = readStr('KEYCLOAK_ISSUER_URL');
  const clientId = readStr('KEYCLOAK_CLIENT_ID');
  const clientSecret = readStr('KEYCLOAK_CLIENT_SECRET');
  if (!issuer || !clientId || !clientSecret) {
    logger.warn('[sso] keycloak is enabled but missing KEYCLOAK_ISSUER_URL/CLIENT_ID/CLIENT_SECRET - disabling it');
    return disabled(id);
  }

  return {
    id,
    enabled: true,
    type: 'oidc',
    label: 'Keycloak',
    issuer,
    // Only needed when the backend reaches the issuer through a different host
    // than the browser does - e.g. the docker-compose Keycloak addon, where the
    // backend talks to it as "keycloak:8080" but the browser must be redirected
    // to "localhost:8080".
    publicIssuer: readStr('KEYCLOAK_PUBLIC_ISSUER_URL') || null,
    allowInsecure: readBool('KEYCLOAK_ALLOW_INSECURE'),
    clientId,
    clientSecret,
    scope: 'openid email profile',
    redirectUri: redirectUriFor(id),
  };
}

function buildLine() {
  const id = 'line';
  if (!readBool('LINE_ENABLED')) return disabled(id);

  const clientId = readStr('LINE_CLIENT_ID');
  const clientSecret = readStr('LINE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    logger.warn('[sso] line is enabled but missing LINE_CLIENT_ID/LINE_CLIENT_SECRET - disabling it');
    return disabled(id);
  }

  return {
    id,
    enabled: true,
    type: 'oidc',
    label: 'LINE',
    issuer: 'https://access.line.me',
    publicIssuer: null,
    allowInsecure: false,
    clientId,
    clientSecret,
    // LINE only returns the "email" claim if the channel has been separately
    // approved by LINE for the email permission - it's requested anyway and
    // handled as optional (see sso.service.js's placeholder-email fallback).
    scope: 'openid profile email',
    redirectUri: redirectUriFor(id),
  };
}

function buildGenericOidc() {
  const id = 'oidc';
  if (!readBool('OIDC_ENABLED')) return disabled(id);

  const issuer = readStr('OIDC_ISSUER_URL');
  const clientId = readStr('OIDC_CLIENT_ID');
  const clientSecret = readStr('OIDC_CLIENT_SECRET');
  if (!issuer || !clientId || !clientSecret) {
    logger.warn('[sso] oidc is enabled but missing OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET - disabling it');
    return disabled(id);
  }

  return {
    id,
    enabled: true,
    type: 'oidc',
    label: readStr('OIDC_DISPLAY_NAME', 'OIDC Provider'),
    issuer,
    publicIssuer: readStr('OIDC_PUBLIC_ISSUER_URL') || null,
    allowInsecure: readBool('OIDC_ALLOW_INSECURE'),
    clientId,
    clientSecret,
    scope: readStr('OIDC_SCOPES', 'openid email profile'),
    redirectUri: redirectUriFor(id),
  };
}

function buildFacebook() {
  const id = 'facebook';
  if (!readBool('FACEBOOK_ENABLED')) return disabled(id);

  const clientId = readStr('FACEBOOK_CLIENT_ID');
  const clientSecret = readStr('FACEBOOK_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    logger.warn('[sso] facebook is enabled but missing FACEBOOK_CLIENT_ID/FACEBOOK_CLIENT_SECRET - disabling it');
    return disabled(id);
  }

  return {
    id,
    enabled: true,
    type: 'facebook',
    label: 'Facebook',
    clientId,
    clientSecret,
    redirectUri: redirectUriFor(id),
  };
}

const providers = {
  facebook: buildFacebook(),
  line: buildLine(),
  keycloak: buildKeycloak(),
  oidc: buildGenericOidc(),
};

for (const provider of Object.values(providers)) {
  if (provider.enabled) logger.info(`[sso] ${provider.id} login enabled`);
}

export function getProvider(id) {
  return providers[id];
}

export function listEnabledProviders() {
  return Object.values(providers)
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.id, label: p.label }));
}
