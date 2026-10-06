import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { getProvider, listEnabledProviders } from '../config/identityProviders.js';
import * as ssoService from '../services/sso.service.js';
import {
  issueSsoStateCookie,
  verifySsoStateCookie,
  clearSsoStateCookie,
  issuePreAuthCookie,
} from '../services/token.service.js';
import { recordEvent } from '../services/audit.service.js';

function redirectToLoginError(res, reason) {
  res.redirect(`${env.FRONTEND_ORIGIN}/#/login?error=${encodeURIComponent(reason)}`);
}

// `error` comes straight from the callback URL, which anyone can craft. OAuth
// error codes are short ASCII tokens (RFC 6749 section 4.1.2.1), so keep only
// those characters - stripping CR/LF stops forged extra log lines (log
// injection), and the length cap stops log/audit-table flooding.
function sanitizeProviderError(value) {
  return String(value).replace(/[^\w.-]/g, '').slice(0, 64) || 'unknown';
}

export const getProviders = asyncHandler(async (req, res) => {
  res.json({ providers: listEnabledProviders() });
});

export const startLogin = asyncHandler(async (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider?.enabled) return redirectToLoginError(res, 'unknown_provider');

  const { authorizationUrl, state } = await ssoService.beginLogin(provider);
  issueSsoStateCookie(res, state);
  res.redirect(authorizationUrl);
});

export const handleCallback = asyncHandler(async (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider?.enabled) return redirectToLoginError(res, 'unknown_provider');

  let statePayload;
  try {
    statePayload = verifySsoStateCookie(req, provider.id);
  } catch {
    return redirectToLoginError(res, 'sso_expired');
  }
  clearSsoStateCookie(res);

  if (req.query.error) {
    const errorCode = sanitizeProviderError(req.query.error);
    logger.warn(`[sso] ${provider.id} callback returned an error: ${errorCode}`);
    await recordEvent({
      eventType: 'sso_login_failed',
      ipAddress: req.ip,
      metadata: { provider: provider.id, error: errorCode },
    });
    return redirectToLoginError(res, 'sso_denied');
  }

  let user;
  try {
    user = await ssoService.completeLogin(provider, req, statePayload);
  } catch (err) {
    logger.error(`[sso] ${provider.id} callback failed`, err);
    await recordEvent({ eventType: 'sso_login_failed', ipAddress: req.ip, metadata: { provider: provider.id } });
    return redirectToLoginError(res, 'sso_failed');
  }

  // An admin disabling an account must be a complete block on that account,
  // not just on the password login form - otherwise disabling someone only
  // stops the login method they happened to use last, while an identity
  // provider they'd also linked would still let them straight back in.
  if (user.status === 'disabled') {
    await recordEvent({
      userId: user.id,
      eventType: 'sso_login_failed',
      ipAddress: req.ip,
      metadata: { provider: provider.id, reason: 'account_disabled' },
    });
    return redirectToLoginError(res, 'sso_denied');
  }

  await recordEvent({ userId: user.id, eventType: 'sso_login_success', ipAddress: req.ip, metadata: { provider: provider.id } });

  // From here on this is exactly the same fork every password login goes
  // through - an external identity provider vouching for who the user is
  // does not exempt the account from this app's own mandatory 2FA.
  const stage = user.totp_enabled ? 'verify' : 'setup';
  issuePreAuthCookie(res, user.id, stage);
  res.redirect(`${env.FRONTEND_ORIGIN}/#/2fa/${stage}`);
});
