/**
 * Next.js Edge Middleware — runs before every request.
 * Redirects unauthenticated users to /login.
 * Redirects already-authenticated users away from /login.
 *
 * NOTE: Firebase Admin SDK cannot run in the Edge runtime, so we do a lightweight
 * cookie-presence check here. Full token verification happens inside each API route
 * via getAuthUser() (Node.js runtime).
 */
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/session', '/api/accounts/callback', '/api/cron/', '/api/admin/', '/api/debug-']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const session = req.cookies.get('__session')?.value

  // Allow public paths and static files through
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/workbox-') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/logos/') ||
    pathname === '/apple-touch-icon.png'
  ) {
    return NextResponse.next()
  }

  // Allow Bearer-authed API requests through (mobile app / API clients)
  if (!session && pathname.startsWith('/api/') && req.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.next()
  }

  // No session → redirect to login
  if (!session) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already logged in and hitting /login → redirect to refunds
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/refunds', req.url))
  }

  return NextResponse.next()
}

export const config = {
  // Run on all routes except Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
