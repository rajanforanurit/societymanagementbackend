import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import { authController as c } from './auth.controller';
import * as s from './auth.schema';

const ALL = Object.values(UserType);

export const authRouter = new ModuleRouter('/api/v1/auth', {
  tag: 'Authentication',
  tagDescription: 'Registration, OTP, login, token refresh and session management',
  roles: ALL,
});

authRouter
  .add({ method: 'post', path: '/otp/request', public: true, limiter: authLimiter, summary: 'Request an OTP', description: 'Sends a one-time password to the mobile number. The response is identical for unknown numbers to prevent account enumeration. Outside production the OTP is echoed as devOtp.', body: s.requestOtpBody, response: s.otpResponse, errors: [409, 429], handler: c.requestOtp })
  .add({ method: 'post', path: '/register', public: true, limiter: authLimiter, summary: 'Register a resident account', description: 'Creates a RESIDENT user after OTP (purpose REGISTER) verification. Joining a society happens afterwards through POST /api/v1/user/society-requests.', body: s.registerBody, response: s.tokenResponse, status: 201, errors: [400, 409, 429], handler: c.register })
  .add({ method: 'post', path: '/login', public: true, limiter: authLimiter, summary: 'Login with mobile/email and password', description: 'If the account has exactly one active society it is selected automatically; otherwise pass societyId or call /switch-society.', body: s.loginBody, response: s.tokenResponse, status: 200, errors: [401, 403, 429], handler: c.login })
  .add({ method: 'post', path: '/login/otp', public: true, limiter: authLimiter, summary: 'Login with mobile OTP', body: s.loginOtpBody, response: s.tokenResponse, status: 200, errors: [400, 401, 403, 429], handler: c.loginOtp })
  .add({ method: 'post', path: '/refresh', public: true, limiter: authLimiter, summary: 'Rotate refresh token', description: 'Refresh tokens are single use. Reuse of a rotated token revokes the entire token family.', body: s.refreshBody, response: s.tokenResponse, status: 200, errors: [401], handler: c.refresh })
  .add({ method: 'post', path: '/logout', summary: 'Logout current session or all devices', body: s.logoutBody, response: null, status: 200, handler: c.logout })
  .add({ method: 'post', path: '/switch-society', summary: 'Switch active society', description: 'Issues new tokens scoped to another society the account has active access to.', body: s.switchSocietyBody, response: s.tokenResponse, status: 200, errors: [403], handler: c.switchSociety })
  .add({ method: 'post', path: '/password/forgot', public: true, limiter: authLimiter, summary: 'Request a password-reset OTP', body: s.forgotPasswordBody, response: s.otpResponse, status: 200, errors: [429], handler: c.forgotPassword })
  .add({ method: 'post', path: '/password/reset', public: true, limiter: authLimiter, summary: 'Reset password with OTP', body: s.resetPasswordBody, response: null, status: 200, errors: [400, 429], handler: c.resetPassword })
  .add({ method: 'post', path: '/password/change', summary: 'Change password', description: 'Revokes every existing session after the change.', body: s.changePasswordBody, response: null, status: 200, errors: [400], handler: c.changePassword })
  .add({ method: 'get', path: '/me', summary: 'Current account, memberships and effective permissions', response: s.meResponse, handler: c.me })
  .add({ method: 'get', path: '/societies/search', public: true, limiter: authLimiter, summary: 'Search active societies to join', description: 'Public minimal lookup (name, code, city) used by resident onboarding.', query: s.societySearchQuery, response: z.array(s.societyLookup), handler: c.societies });
