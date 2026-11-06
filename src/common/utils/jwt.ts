import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../../config/env';
import { UserType } from '../constants/enums';

const ISSUER = 'society-management-api';

export interface AccessPayload extends JwtPayload {
  sub: string;
  ut: UserType;
  tv: number;
  sid?: string;
  imp?: string;
}

export interface RefreshPayload extends JwtPayload {
  sub: string;
  jti: string;
  fam: string;
  sid?: string;
}

export const signAccessToken = (p: { sub: string; ut: UserType; tv: number; sid?: string; imp?: string }, ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS) =>
  jwt.sign(p, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: ttlSeconds, issuer: ISSUER });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER }) as AccessPayload;

export const signRefreshToken = (p: { sub: string; jti: string; fam: string; sid?: string }) =>
  jwt.sign(p, env.JWT_REFRESH_SECRET, { algorithm: 'HS256', expiresIn: env.REFRESH_TOKEN_TTL_DAYS * 86400, issuer: ISSUER });

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: ISSUER }) as RefreshPayload;
