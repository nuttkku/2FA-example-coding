import { Router } from 'express';
import { loginLimiter } from '../middleware/rateLimit.middleware.js';
import * as sso from '../controllers/sso.controller.js';

const router = Router();

router.get('/providers', sso.getProviders);
router.get('/:provider/start', loginLimiter, sso.startLogin);
router.get('/:provider/callback', loginLimiter, sso.handleCallback);

export default router;
