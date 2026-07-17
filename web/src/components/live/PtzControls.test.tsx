import { fireEvent, render, screen } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import PtzControls from './PtzControls';

afterEach(() => vi.unstubAllGlobals());

function okFetch() {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function bodyOf(call: unknown[]): { command: string } {
  return JSON.parse((call[1] as RequestInit).body as string);
}

it('press sends the move command, release sends stop, for every direction', () => {
  const spy = okFetch();
  render(<PtzControls profileId="p1" />);
  const cases: Array<[RegExp, string]> = [
    [/^up$/i, 'up'], [/^down$/i, 'down'], [/^left$/i, 'left'], [/^right$/i, 'right'],
    [/zoom in/i, 'in'], [/zoom out/i, 'out'],
  ];
  for (const [name, command] of cases) {
    const btn = screen.getByRole('button', { name });
    fireEvent.pointerDown(btn);
    expect(bodyOf(spy.mock.calls.at(-1)!)).toEqual({ command });
    fireEvent.pointerUp(btn);
    expect(bodyOf(spy.mock.calls.at(-1)!)).toEqual({ command: 'stop' });
  }
});

it('dragging off a held button also stops', () => {
  const spy = okFetch();
  render(<PtzControls profileId="p1" />);
  const btn = screen.getByRole('button', { name: /^left$/i });
  fireEvent.pointerDown(btn);
  fireEvent.pointerLeave(btn);
  expect(bodyOf(spy.mock.calls.at(-1)!)).toEqual({ command: 'stop' });
});

it('does not send a stray stop on release without a press', () => {
  const spy = okFetch();
  render(<PtzControls profileId="p1" />);
  fireEvent.pointerUp(screen.getByRole('button', { name: /^left$/i }));
  fireEvent.pointerLeave(screen.getByRole('button', { name: /^up$/i }));
  expect(spy).not.toHaveBeenCalled();
});

it('sends stop on unmount while a move is held (navigation must not leave the camera moving)', () => {
  const spy = okFetch();
  const { unmount } = render(<PtzControls profileId="p1" />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /^up$/i }));
  unmount();
  expect(bodyOf(spy.mock.calls.at(-1)!)).toEqual({ command: 'stop' });
});

it('does not send stop on unmount when nothing is moving', () => {
  const spy = okFetch();
  const { unmount } = render(<PtzControls profileId="p1" />);
  unmount();
  expect(spy).not.toHaveBeenCalled();
});

it('Stop button always works, even while another command is still in flight', () => {
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string).command);
    return new Promise<Response>(() => {}); // never resolves — a hung request
  }));
  render(<PtzControls profileId="p1" />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /^up$/i }));
  const stopBtn = screen.getByRole('button', { name: /^stop$/i });
  expect(stopBtn).not.toBeDisabled();
  fireEvent.click(stopBtn);
  expect(bodies).toEqual(['up', 'stop']);
});

it('supports keyboard hold: keydown moves (once, ignoring auto-repeat), keyup stops', () => {
  const spy = okFetch();
  render(<PtzControls profileId="p1" />);
  const btn = screen.getByRole('button', { name: /^right$/i });
  fireEvent.keyDown(btn, { key: 'Enter' });
  fireEvent.keyDown(btn, { key: 'Enter', repeat: true });
  fireEvent.keyUp(btn, { key: 'Enter' });
  expect(spy.mock.calls.map(bodyOf)).toEqual([{ command: 'right' }, { command: 'stop' }]);
});

it('shows a manage-permission message on 403', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<PtzControls profileId="p1" />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /^up$/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});

it('shows a generic message on a non-403 failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
  render(<PtzControls profileId="p1" />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /^up$/i }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/command failed/i);
  expect(alert).not.toHaveTextContent(/boom/); // raw body never leaked
});
