import { StringValue } from 'ms';

export const jwtConstants = {
  secret: process.env.JWT_SECRET || 'aalapSecretKey',
  expiresIn: (process.env.JWT_EXPIRES_IN as StringValue) || '15m',
  refreshSecret: process.env.REFRESH_JWT_SECRET || 'aalapRefreshSecretKey',
  refreshExpiresIn: (process.env.REFRESH_JWT_EXPIRES_IN as StringValue) || '7d',
};
