import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import NavBar from './NavBar';

it('logs out: posts /auth/logout then redirects to /login', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<NavBar />);
  await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
  expect(spy.mock.calls[0][0]).toBe('/api/auth/logout');
  expect(replace).toHaveBeenCalledWith('/login');
  vi.unstubAllGlobals();
});
