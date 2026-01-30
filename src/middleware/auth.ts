import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/database';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authorization header is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid authorization format. Use: Bearer <token>',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const config = getConfig();

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as {
        sub: string;
        email: string;
        role: string;
      };

      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'user',
      };

      next();
    } catch (jwtError) {
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    next(error);
  }
}

export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next();
      return;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme === 'Bearer' && token) {
      const config = getConfig();

      try {
        const decoded = jwt.verify(token, config.jwtSecret) as {
          sub: string;
          email: string;
          role: string;
        };

        req.user = {
          id: decoded.sub,
          email: decoded.email,
          role: decoded.role || 'user',
        };
      } catch {
        // Token invalid but auth is optional, continue without user
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next();
  };
}

// API Key authentication for service-to-service communication
export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key is required',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // In production, validate against stored API keys
  const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');

  if (!validApiKeys.includes(apiKey)) {
    res.status(401).json({
      error: {
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  next();
}
