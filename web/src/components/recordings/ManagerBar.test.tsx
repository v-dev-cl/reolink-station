import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import ManagerBar from './ManagerBar';

afterEach(() => { vi.unstubAllGlobals(); });

it('deletes the selection after confirmation and reports the count', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn(async () => new Response('{"deleted":2}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  const onMutated = vi.fn();
  render(<ManagerBar profileId="p1" selected={['a.mp4', 'b.jpg']} onMutated={onMutated} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected \(2\)/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ paths: ['a.mp4', 'b.jpg'] });
  expect(await screen.findByText(/deleted 2 files/i)).toBeInTheDocument();
  expect(onMutated).toHaveBeenCalled();
});

it('makes no request when confirmation is declined', async () => {
  vi.stubGlobal('confirm', vi.fn(() => false));
  const spy = vi.fn();
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={['a.mp4']} onMutated={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
  expect(spy).not.toHaveBeenCalled();
});

it('shows the manage-permission message on 403', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<ManagerBar profileId="p1" selected={['a.mp4']} onMutated={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});

it('prunes with the entered day count', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn(async () => new Response('{"deleted":7}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  const days = screen.getByLabelText(/older than days/i);
  await userEvent.clear(days);
  await userEvent.type(days, '60');
  await userEvent.click(screen.getByRole('button', { name: /prune/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ olderThanDays: 60 });
  expect(await screen.findByText(/deleted 7 files/i)).toBeInTheDocument();
});

it('rejects an invalid day count without a request', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn();
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  const days = screen.getByLabelText(/older than days/i);
  await userEvent.clear(days);
  await userEvent.click(screen.getByRole('button', { name: /prune/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
  expect(spy).not.toHaveBeenCalled();
});

it('delete is disabled when nothing is selected', () => {
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  expect(screen.getByRole('button', { name: /delete selected \(0\)/i })).toBeDisabled();
});
