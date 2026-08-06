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
    logger.warn(`[sso] ${provider.id} callback returned an error: ${req.query.error}`);
    await recordEvent({
      eventType: 'sso_login_failed',
      ipAddress: req.ip,
      metadata: { provider: provider.id, error: String(req.query.error) },
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
