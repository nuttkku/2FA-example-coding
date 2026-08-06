import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/rbac.middleware.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/users', requirePermission('users:read'), admin.getUsers);
router.post('/users', requirePermission('users:write'), admin.postUser);
router.patch('/users/:id', requirePermission('users:write'), admin.patchUser);
router.post('/users/:id/reset-password', requirePermission('users:write'), admin.postResetPassword);
router.post('/users/:id/reset-2fa', requirePermission('users:write'), admin.postResetTwoFactor);

router.get('/audit-logs', requirePermission('audit:read'), admin.getAuditLogs);

export default router;
