import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import SharePanel from './SharePanel';

it('grants a share by email + permission', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<SharePanel profileId="p1" />);
  await userEvent.type(screen.getByLabelText(/share with email/i), 'parent@x.com');
  await userEvent.selectOptions(screen.getByLabelText(/permission/i), 'view');
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/shares');
  expect(JSON.parse(init.body)).toEqual({ email: 'parent@x.com', permission: 'view' });
});

it('shows a friendly message when the caller lacks manage (403)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<SharePanel profileId="p1" />);
  await userEvent.type(screen.getByLabelText(/share with email/i), 'x@y.z');
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
});
