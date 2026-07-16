import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function reqFor(path: string, hasToken: boolean) {
  const req = new NextRequest(new URL(`http://localhost:3001${path}`));
  if (hasToken) req.cookies.set('access_token', 'x');
  return req;
}

it('redirects unauthenticated visitor on / to /login', () => {
  const res = middleware(reqFor('/', false));
  expect(res.headers.get('location')).toContain('/login');
});
it('lets unauthenticated visitor reach /login', () => {
  const res = middleware(reqFor('/login', false));
  expect(res.headers.get('location')).toBeNull();
});
it('redirects authenticated visitor away from /login to /', () => {
  const res = middleware(reqFor('/login', true));
  const loc = res.headers.get('location');
  expect(loc).not.toBeNull();
  expect(new URL(loc as string).pathname).toBe('/');
});
it('lets authenticated visitor reach a protected route', () => {
  const res = middleware(reqFor('/', true));
  expect(res.headers.get('location')).toBeNull();
});
