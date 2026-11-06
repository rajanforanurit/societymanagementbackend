import { Request, Response } from 'express';
import { created, ok } from '../../common/responses/respond';
import * as svc from './auth.service';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) });

export const authController = {
  requestOtp: async (req: Request, res: Response) => ok(res, await svc.requestOtp(req.valid.body.mobile, req.valid.body.purpose), 'OTP request accepted'),
  register: async (req: Request, res: Response) => created(res, await svc.register(req.valid.body, meta(req)), 'Registration successful'),
  login: async (req: Request, res: Response) => ok(res, await svc.login(req.valid.body, meta(req)), 'Login successful'),
  loginOtp: async (req: Request, res: Response) => ok(res, await svc.loginWithOtp(req.valid.body, meta(req)), 'Login successful'),
  refresh: async (req: Request, res: Response) => ok(res, await svc.refresh(req.valid.body.refreshToken, meta(req)), 'Token refreshed'),
  logout: async (req: Request, res: Response) => {
    await svc.logout(req.auth.userId, req.valid.body);
    ok(res, null, 'Logged out');
  },
  switchSociety: async (req: Request, res: Response) => ok(res, await svc.switchSociety(req.auth.userId, req.valid.body.societyId, meta(req)), 'Society switched'),
  forgotPassword: async (req: Request, res: Response) => ok(res, await svc.forgotPassword(req.valid.body.mobile), 'OTP request accepted'),
  resetPassword: async (req: Request, res: Response) => {
    await svc.resetPassword(req.valid.body);
    ok(res, null, 'Password reset successful');
  },
  changePassword: async (req: Request, res: Response) => {
    await svc.changePassword(req.auth.userId, req.valid.body);
    ok(res, null, 'Password changed. Please sign in again.');
  },
  me: async (req: Request, res: Response) => ok(res, await svc.me(req.auth)),
  societies: async (req: Request, res: Response) => ok(res, await svc.searchSocieties(req.valid.query.q, req.valid.query.limit)),
};
