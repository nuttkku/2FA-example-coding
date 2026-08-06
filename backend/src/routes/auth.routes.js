import { Router } from 'express';
import { requireAuth, requirePreAuth } from '../middleware/auth.middleware.js';
import { loginLimiter, twoFaLimiter } from '../middleware/rateLimit.middleware.js';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', loginLimiter, auth.login);

router.post('/2fa/setup', requirePreAuth('setup'), auth.startTwoFactorSetup);
router.post('/2fa/setup/confirm', twoFaLimiter, requirePreAuth('setup'), auth.confirmTwoFactorSetup);
router.post('/2fa/verify', twoFaLimiter, requirePreAuth('verify'), auth.verifyTwoFactor);

router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);

router.get('/me', requireAuth, auth.me);
router.post('/change-password', requireAuth, auth.changePassword);
router.post('/2fa/backup-codes/regenerate', requireAuth, auth.regenerateBackupCodes);

export default router;
