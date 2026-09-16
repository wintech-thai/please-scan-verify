/**
 * API Route: /api/proxy
 *
 * Generic proxy endpoint that forwards requests to backend URLs.
 * This hides the actual backend API URLs from the client.
 *
 * Usage:
 *   GET  /api/proxy?url=<base64_encoded_backend_url>
 *   POST /api/proxy?url=<base64_encoded_backend_url>
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// Constants
// ============================================================================

const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const REQUEST_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decode base64-encoded URL
 */
function decodeProxyUrl(encodedUrl: string): string {
  try {
    const decoded = Buffer.from(encodedUrl, "base64").toString("utf-8");

    // Validate URL format
    const url = new URL(decoded);

    // Security: Whitelist of allowed backend domains
    // Add your production/staging domains here
    const allowedDomains = [
      "api-dev.please-scan.com",
      "scan-dev.please-scan.com",
      "api.please-scan.com",
      "scan.please-scan.com",
      "api-staging.please-scan.com",
      "scan-staging.please-scan.com",
      // On-prem domains (naming convention: same name + "2", see x075)
      "api2-dev.please-scan.com",
      "scan2-dev.please-scan.com",
      "api2.please-scan.com",
      "scan2.please-scan.com",
      "localhost", // For local development
      "127.0.0.1", // For local development
    ];

    // Optional: Also allow domain from API_BASE_URL if configured
    const apiBaseUrl = process.env.API_BASE_URL;
    if (apiBaseUrl) {
      try {
        const configuredDomain = new URL(apiBaseUrl).hostname;
        if (!allowedDomains.includes(configuredDomain)) {
          allowedDomains.push(configuredDomain);
        }
      } catch {
        // Ignore invalid API_BASE_URL
      }
    }

    // Check if the decoded URL hostname is in allowed list
    if (!allowedDomains.includes(url.hostname)) {
      throw new Error(`Invalid URL: hostname ${url.hostname} not allowed`);
    }

    return decoded;
  } catch (error) {
    throw new Error(
      `Invalid URL encoding: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * GET handler - proxy GET requests
 */
export async function GET(request: NextRequest) {
  try {
    // Get encoded URL from query params
    const encodedUrl = request.nextUrl.searchParams.get("url");

    if (!encodedUrl) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "ไม่พบ URL parameter",
          descriptionEng: "Missing URL parameter",
        },
        { status: 400 },
      );
    }

    // Decode URL
    let targetUrl: string;
    try {
      targetUrl = decodeProxyUrl(encodedUrl);
    } catch (error) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "URL ไม่ถูกต้อง",
          descriptionEng:
            error instanceof Error ? error.message : "Invalid URL",
        },
        { status: 400 },
      );
    }

    // Handle URL parameter replacements (e.g., {email}, {phone}, etc.)
    // These are passed as additional query parameters
    const searchParams = request.nextUrl.searchParams;
    for (const [key, value] of searchParams.entries()) {
      if (key !== "url") {
        // Replace placeholders like {email} with actual values
        const placeholder = `{${key}}`;
        if (targetUrl.includes(placeholder)) {
          targetUrl = targetUrl.replace(placeholder, encodeURIComponent(value));
        } else if (key === "email") {
          // If no {email} placeholder but email param exists, append to path
          // This handles backend URLs that don't include the placeholder
          targetUrl = `${targetUrl}/${encodeURIComponent(value)}`;
        }
      }
    }

    console.log(`Proxying GET request to: ${targetUrl}`);

    // Forward request to backend
    const response = await fetchWithTimeout(targetUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Get response data
    const contentType = response.headers.get("content-type");
    let data: unknown;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Return proxied response
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Proxy GET error:", error);

    return NextResponse.json(
      {
        status: "ERROR",
        descriptionThai: "เกิดข้อผิดพลาดในการเชื่อมต่อ",
        descriptionEng: `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }
}

/**
 * POST handler - proxy POST requests
 */
export async function POST(request: NextRequest) {
  try {
    // Get encoded URL from query params
    const encodedUrl = request.nextUrl.searchParams.get("url");

    if (!encodedUrl) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "ไม่พบ URL parameter",
          descriptionEng: "Missing URL parameter",
        },
        { status: 400 },
      );
    }

    // Decode URL
    let targetUrl: string;
    try {
      targetUrl = decodeProxyUrl(encodedUrl);
    } catch (error) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "URL ไม่ถูกต้อง",
          descriptionEng:
            error instanceof Error ? error.message : "Invalid URL",
        },
        { status: 400 },
      );
    }

    // Handle URL parameter replacements (e.g., {email}, {phone}, etc.)
    // These are passed as additional query parameters
    const searchParams = request.nextUrl.searchParams;
    for (const [key, value] of searchParams.entries()) {
      if (key !== "url") {
        // Replace placeholders like {email} with actual values
        const placeholder = `{${key}}`;
        if (targetUrl.includes(placeholder)) {
          targetUrl = targetUrl.replace(placeholder, encodeURIComponent(value));
        } else if (key === "email") {
          // If no {email} placeholder but email param exists, append to path
          // This handles backend URLs that don't include the placeholder
          targetUrl = `${targetUrl}/${encodeURIComponent(value)}`;
        }
      }
    }

    // Get request body
    let body: unknown;
    try {
      const contentType = request.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        body = await request.json();
      } else {
        body = await request.text();
      }
    } catch (error) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "ข้อมูลไม่ถูกต้อง",
          descriptionEng: "Invalid request body",
        },
        { status: 400 },
      );
    }

    console.log(`Proxying POST request to: ${targetUrl}`);

    // Forward request to backend
    const response = await fetchWithTimeout(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    // Get response data
    const contentType = response.headers.get("content-type");
    let data: unknown;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Return proxied response
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Proxy POST error:", error);

    return NextResponse.json(
      {
        status: "ERROR",
        descriptionThai: "เกิดข้อผิดพลาดในการเชื่อมต่อ",
        descriptionEng: `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }
}

/**
 * PUT handler - proxy PUT requests
 */
export async function PUT(request: NextRequest) {
  // Similar to POST, reuse the logic
  return handleMutationRequest(request, "PUT");
}

/**
 * DELETE handler - proxy DELETE requests
 */
export async function DELETE(request: NextRequest) {
  // Similar to POST, reuse the logic
  return handleMutationRequest(request, "DELETE");
}

/**
 * Generic handler for mutation requests (POST, PUT, DELETE, PATCH)
 */
async function handleMutationRequest(
  request: NextRequest,
  method: string,
): Promise<NextResponse> {
  try {
    const encodedUrl = request.nextUrl.searchParams.get("url");

    if (!encodedUrl) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "ไม่พบ URL parameter",
          descriptionEng: "Missing URL parameter",
        },
        { status: 400 },
      );
    }

    let targetUrl: string;
    try {
      targetUrl = decodeProxyUrl(encodedUrl);
    } catch (error) {
      return NextResponse.json(
        {
          status: "ERROR",
          descriptionThai: "URL ไม่ถูกต้อง",
          descriptionEng:
            error instanceof Error ? error.message : "Invalid URL",
        },
        { status: 400 },
      );
    }

    // Handle URL parameter replacements (e.g., {email}, {phone}, etc.)
    // These are passed as additional query parameters
    const searchParams = request.nextUrl.searchParams;
    for (const [key, value] of searchParams.entries()) {
      if (key !== "url") {
        // Replace placeholders like {email} with actual values
        const placeholder = `{${key}}`;
        if (targetUrl.includes(placeholder)) {
          targetUrl = targetUrl.replace(placeholder, encodeURIComponent(value));
        } else if (key === "email") {
          // If no {email} placeholder but email param exists, append to path
          // This handles backend URLs that don't include the placeholder
          targetUrl = `${targetUrl}/${encodeURIComponent(value)}`;
        }
      }
    }

    let body: unknown = undefined;
    if (method !== "DELETE") {
      try {
        const contentType = request.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          body = await request.json();
        } else {
          body = await request.text();
        }
      } catch {
        // Body is optional for some methods
      }
    }

    console.log(`Proxying ${method} request to: ${targetUrl}`);

    const response = await fetchWithTimeout(targetUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined,
    });

    const contentType = response.headers.get("content-type");
    let data: unknown;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(`Proxy ${method} error:`, error);

    return NextResponse.json(
      {
        status: "ERROR",
        descriptionThai: "เกิดข้อผิดพลาดในการเชื่อมต่อ",
        descriptionEng: `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }
}
