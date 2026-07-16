import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import PtzControls from './PtzControls';

afterEach(() => vi.unstubAllGlobals());

it('sends the matching command for each direction/zoom button', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^left$/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ command: 'left' });
  await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
  expect(JSON.parse(spy.mock.calls[1][1].body)).toEqual({ command: 'in' });
  await userEvent.click(screen.getByRole('button', { name: /^stop$/i }));
  expect(JSON.parse(spy.mock.calls[2][1].body)).toEqual({ command: 'stop' });
});

it('shows a manage-permission message on 403', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^up$/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});
