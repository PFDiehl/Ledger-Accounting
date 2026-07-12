export function securityHeaders(req, res, next) { next(); }
export function requestId(req, res, next) { next(); }
export function responseTime(req, res, next) { next(); }
export function orgRateLimit(opts) { return (req, res, next) => next(); }
export function queryGuard(req, res, next) { next(); }
export function cacheMiddleware(ttl, keyFn) { return (req, res, next) => next(); }