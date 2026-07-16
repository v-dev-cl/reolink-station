import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login'];

export function middleware(req: NextRequest) {
  const hasToken = req.cookies.has('access_token');
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!hasToken && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (hasToken && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
