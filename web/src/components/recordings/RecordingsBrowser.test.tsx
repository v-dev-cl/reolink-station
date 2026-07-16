import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import RecordingsBrowser from './RecordingsBrowser';

afterEach(() => { vi.unstubAllGlobals(); });

const root = [{ name: '2026', path: '2026', type: 'dir', size: 0, mtime: 0 }];
const files = [
  { name: 'clip.mp4', path: '2026/clip.mp4', type: 'file', size: 5, mtime: 2 },
  { name: 'shot.jpg', path: '2026/shot.jpg', type: 'file', size: 2, mtime: 1 },
];

function stubListing() {
  return vi.fn(async (url: string) => {
    const dir = new URL(url, 'http://x').searchParams.get('dir') ?? '';
    return new Response(JSON.stringify(dir === '' ? root : files), { status: 200 });
  });
}

it('lists folders at the root and drills down to files', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  expect(await screen.findByText('clip.mp4')).toBeInTheDocument();
  expect(screen.getByText('shot.jpg')).toBeInTheDocument();
});

it('breadcrumb returns to the root listing', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  await screen.findByText('clip.mp4');
  await userEvent.click(screen.getByRole('button', { name: /^recordings$/i }));
  expect(await screen.findByRole('button', { name: /open folder 2026/i })).toBeInTheDocument();
});

it('opens the player when a file is opened', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  await userEvent.click(await screen.findByRole('button', { name: /open clip.mp4/i }));
  expect(screen.getByRole('dialog', { name: 'clip.mp4' })).toBeInTheDocument();
});

it('shows an alert when listing fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
  render(<RecordingsBrowser profileId="p1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
});

it('shows an empty state for a folder with no entries', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  render(<RecordingsBrowser profileId="p1" />);
  expect(await screen.findByText(/no recordings/i)).toBeInTheDocument();
});
