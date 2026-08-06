import * as oidcClientService from './oidcClient.service.js';
import * as facebookService from './facebook.service.js';
import { findByOAuthIdentity, linkOAuthIdentity, createUserFromOAuth, findByEmail } from './user.service.js';
import { recordEvent } from './audit.service.js';

function serviceFor(provider) {
  return provider.type === 'facebook' ? facebookService : oidcClientService;
}

export async function beginLogin(provider) {
  return serviceFor(provider).beginLogin(provider);
}

// Matches an external identity to a local user, in priority order:
//   1. An oauth_identities row already links this exact (provider, providerUserId).
//   2. The provider reports a verified email that matches an existing local
//      account - link automatically. Only done for *verified* emails: an
//      unverified email claim could belong to someone who doesn't actually
//      control that address, which would otherwise let them take over an
//      unrelated existing account.
//   3. The email matches an existing account but isn't verified - refuse to
//      link (see above) *and* refuse to reuse that address on a new account
//      (it would violate the unique email constraint, and would otherwise let
//      an unverified claim silently masquerade as that address anyway); fall
//      through to a synthetic placeholder for an unrelated new account.
//   4. No account to link to at all - provision a new one. If the provider gave
//      an email and nothing else is using it, use it as-is (safe either way,
//      since there's no existing account at stake here) rather than needlessly
//      discarding a perfectly usable address just because it lacked a
//      verification flag. Providers that return no email at all (e.g. LINE
//      without the separately-approved email permission) get a clearly
//      synthetic placeholder so the NOT-NULL/UNIQUE email column is satisfied.
async function findOrCreateUserFromIdentity(providerId, identity) {
  const { providerUserId, email: rawEmail, emailVerified, name } = identity;

  const existing = await findByOAuthIdentity(providerId, providerUserId);
  if (existing) return existing;

  const normalizedEmail = rawEmail ? rawEmail.toLowerCase() : null;
  const existingByEmail = normalizedEmail ? await findByEmail(normalizedEmail) : null;

  if (existingByEmail && emailVerified) {
    await linkOAuthIdentity(existingByEmail.id, providerId, providerUserId, normalizedEmail);
    await recordEvent({
      userId: existingByEmail.id,
      eventType: 'sso_identity_linked',
      metadata: { provider: providerId },
    });
    return existingByEmail;
  }

  const canUseRealEmail = normalizedEmail && !existingByEmail;
  const newAccountEmail = canUseRealEmail ? normalizedEmail : `${providerId}.${providerUserId}@sso.local`;

  const user = await createUserFromOAuth({ email: newAccountEmail, fullName: name || newAccountEmail });
  await linkOAuthIdentity(user.id, providerId, providerUserId, rawEmail ?? null);
  await recordEvent({ userId: user.id, eventType: 'sso_user_created', metadata: { provider: providerId } });
  return user;
}

export async function completeLogin(provider, req, statePayload) {
  const identity = await serviceFor(provider).completeLogin(provider, req, statePayload);
  return findOrCreateUserFromIdentity(provider.id, identity);
}
