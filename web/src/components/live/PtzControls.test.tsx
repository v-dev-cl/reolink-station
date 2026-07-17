import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import PtzControls from './PtzControls';

afterEach(() => vi.unstubAllGlobals());

it('sends the matching command for every button', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<PtzControls profileId="p1" />);
  const cases: Array<[RegExp, string]> = [
    [/^up$/i, 'up'], [/^down$/i, 'down'], [/^left$/i, 'left'], [/^right$/i, 'right'],
    [/zoom in/i, 'in'], [/zoom out/i, 'out'], [/^stop$/i, 'stop'],
  ];
  for (let i = 0; i < cases.length; i++) {
    await userEvent.click(screen.getByRole('button', { name: cases[i][0] }));
    expect(JSON.parse(spy.mock.calls[i][1].body)).toEqual({ command: cases[i][1] });
  }
});

it('shows a manage-permission message on 403', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^up$/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});

it('shows a generic message on a non-403 failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^up$/i }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/command failed/i);
  expect(alert).not.toHaveTextContent(/boom/); // raw body never leaked
});

it('disables the buttons while a command is in flight', async () => {
  let resolveFetch: (r: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { resolveFetch = res; })));
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^up$/i }));
  expect(screen.getByRole('button', { name: /^down$/i })).toBeDisabled();
  resolveFetch(new Response('{"ok":true}', { status: 201 }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^down$/i })).not.toBeDisabled());
});
