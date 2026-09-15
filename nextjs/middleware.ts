/**
 * Audit logging middleware for Onix v2 Web Scan
 * Logs all requests with performance metrics and custom status
 * Ported from Middlewares/AuditLogMiddleware.cs
 * 
 * Note: Next.js 15 middleware runs in Edge Runtime by default
 * No need to explicitly declare runtime
 */

import { NextRequest, NextResponse } from 'next/server';

// Log version info on first load (using a flag to prevent multiple logs)
let versionLogged = false;
if (!versionLogged) {
  const commitId = process.env.NEXT_PUBLIC_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown';
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '2.0.0';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || 'unknown';
  
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 ONIX v2 Web Scan - Application Started');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📦 Version:    ${version}`);
  console.log(`🔖 Commit ID:  ${commitId}`);
  console.log(`🕐 Build Time: ${buildTime}`);
  console.log(`🌍 Environment: ${process.env.RUNTIME_ENV || 'development'}`);
  console.log('═══════════════════════════════════════════════════');
  
  versionLogged = true;
}

// Audit log structure matching the C# implementation
interface AuditLog {
  Host: string;
  HttpMethod: string;
  StatusCode: number;
  Path: string;
  QueryString: string;
  UserAgent: string;
  RequestSize: number;
  ResponseSize: number;
  LatencyMs: number;
  Scheme: string;
  ClientIp: string;
  CfClientIp: string;
  CustomStatus: string;
  CustomDesc: string;
  Environment: string | undefined;
  userInfo: UserInfo;
}

interface UserInfo {
  // Add user info fields as needed
  userId?: string;
  sessionId?: string;
}

/**
 * Middleware function for audit logging
 * Logs all requests except /health endpoint
 */
export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  
  // Extract request information
  const method = request.method;
  const path = request.nextUrl.pathname;
  const queryString = request.nextUrl.search;
  const scheme = request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const userAgent = request.headers.get('user-agent') || '';
  
  // Extract client IP
  let clientIp = '';
  const xForwardedFor = request.headers.get('x-original-forwarded-for') || request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    clientIp = xForwardedFor.split(',')[0].trim();
  }
  
  // Cloudflare client IP
  const cfClientIp = request.headers.get('cf-connecting-ip') || '';
  
  // Get request size (approximate)
  const requestSize = parseInt(request.headers.get('content-length') || '0', 10);

  // Continue to next middleware/page
  const response = NextResponse.next();
  
  // Skip audit logging for health endpoint
  if (path === '/health' || path === '/api/health') {
    return response;
  }

  // Calculate response time
  const endTime = Date.now();
  const latencyMs = endTime - startTime;
  
  // Get custom status from response headers (set by page/API)
  const customStatus = response.headers.get('CUST_STATUS') || '';
  
  // Get response size (approximate, since we can't easily measure in middleware)
  const responseSize = 0; // Will be set by the actual response
  
  // Build audit log object
  // Note: process.env is available in Edge Runtime for build-time env vars
  const auditLog: AuditLog = {
    Host: host,
    HttpMethod: method,
    StatusCode: response.status,
    Path: path,
    QueryString: queryString,
    UserAgent: userAgent,
    RequestSize: requestSize,
    ResponseSize: responseSize,
    LatencyMs: latencyMs,
    Scheme: scheme,
    ClientIp: clientIp,
    CfClientIp: cfClientIp,
    CustomStatus: customStatus,
    CustomDesc: response.status !== 200 ? response.statusText : '',
    Environment: process.env.RUNTIME_ENV || 'production',
    userInfo: {
      // Add user info extraction logic here
    },
  };

  // Log to console (structured JSON)
  console.log(JSON.stringify(auditLog));

  // Send to Redis (via the /api/audit-log route — middleware runs on the Edge
  // runtime and can't use ioredis directly, see route.ts for why)
  await sendAuditLog(auditLog, request.nextUrl.origin);

  return response;
}

/**
 * Publishes the audit log to Redis via the internal /api/audit-log route.
 * @param auditLog - Audit log object
 * @param origin - Request origin, used to build an absolute URL for the fetch
 *   (middleware's fetch can't use relative paths)
 */
async function sendAuditLog(auditLog: AuditLog, origin: string): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/audit-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditLog),
    });

    if (!response.ok) {
      console.warn(`Failed to send audit log, status code = [${response.status}]`);
    }
  } catch (error) {
    console.error('Error sending audit log:', error instanceof Error ? error.message : 'Unknown error');
  }
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     * - api/audit-log (the route this middleware posts to — excluded so
     *   logging that request doesn't recurse into itself)
     */
    '/((?!_next/static|_next/image|favicon.ico|scan-static|api/audit-log).*)',
  ],
};
