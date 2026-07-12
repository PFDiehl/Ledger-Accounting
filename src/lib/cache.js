export const redis = null;
export async function cacheGet(k) { return null; }
export async function cacheSet(k,v,t) {}
export async function cacheDel(k) {}
export function cacheMiddleware(t,f) { return (req,res,next) => next(); }
export const cached = cacheMiddleware;
export const keys = {};
export function invalidateAfterInvoiceChange() { return (req,res,next) => next(); }