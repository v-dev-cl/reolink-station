import { act, render, screen, waitFor } from '@testing-library/react';
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

it('shows the Prune control at the root, which only contains subfolders', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await screen.findByRole('button', { name: /open folder 2026/i });
  expect(screen.getByRole('button', { name: /prune/i })).toBeInTheDocument();
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

it('discards a stale listing that resolves after a newer navigation', async () => {
  let resolve2026: (r: Response) => void = () => {};
  const fetchMock = vi.fn((url: string) => {
    const dir = new URL(url, 'http://x').searchParams.get('dir') ?? '';
    if (dir === '2026') return new Promise<Response>((res) => { resolve2026 = res; }); // deferred
    return Promise.resolve(new Response(JSON.stringify(root), { status: 200 }));       // root, immediate
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i })); // fetch A (pending)
  await userEvent.click(screen.getByRole('button', { name: /^recordings$/i }));            // fetch B (root, resolves)
  await screen.findByRole('button', { name: /open folder 2026/i });                        // back at root

  // Stale A arrives last. Its promise chain (fetch -> res.text() -> JSON.parse -> setEntries)
  // takes several microtask ticks to settle, so flush past a real timer tick inside act()
  // before asserting — otherwise a check that runs too early would pass even without the
  // guard, because the (buggy) overwrite just hasn't landed yet.
  await act(async () => {
    resolve2026(new Response(JSON.stringify(files), { status: 200 }));
    await new Promise((r) => setTimeout(r, 50));
  });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /open folder 2026/i })).toBeInTheDocument();
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });
});

it('clears selection when navigating away and back into a folder', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  const checkbox = await screen.findByRole('checkbox', { name: /select clip\.mp4/i });
  await userEvent.click(checkbox);
  expect(checkbox).toBeChecked();

  await userEvent.click(screen.getByRole('button', { name: /^recordings$/i }));
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  const checkboxAgain = await screen.findByRole('checkbox', { name: /select clip\.mp4/i });
  expect(checkboxAgain).not.toBeChecked();
});

it('clears selection after a mutation via ManagerBar', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/delete')) {
      return new Response(JSON.stringify({ deleted: 1 }), { status: 200 });
    }
    const dir = new URL(url, 'http://x').searchParams.get('dir') ?? '';
    return new Response(JSON.stringify(dir === '' ? root : files), { status: 200 });
  }));
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  const checkbox = await screen.findByRole('checkbox', { name: /select clip\.mp4/i });
  await userEvent.click(checkbox);
  expect(checkbox).toBeChecked();

  await userEvent.click(screen.getByRole('button', { name: /delete selected \(1\)/i }));

  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: /select clip\.mp4/i })).not.toBeChecked();
  });
});

it('navigates to the correct dir when clicking a mid-path breadcrumb segment', async () => {
  const nested: Record<string, unknown> = {
    '': [{ name: '2026', path: '2026', type: 'dir', size: 0, mtime: 0 }],
    '2026': [{ name: '07', path: '2026/07', type: 'dir', size: 0, mtime: 0 }],
    '2026/07': [{ name: '15', path: '2026/07/15', type: 'dir', size: 0, mtime: 0 }],
    '2026/07/15': [{ name: 'clip.mp4', path: '2026/07/15/clip.mp4', type: 'file', size: 5, mtime: 2 }],
  };
  const fetchMock = vi.fn(async (url: string) => {
    const dir = new URL(url, 'http://x').searchParams.get('dir') ?? '';
    return new Response(JSON.stringify(nested[dir] ?? []), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<RecordingsBrowser profileId="p1" />);

  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  await userEvent.click(await screen.findByRole('button', { name: /open folder 07/i }));
  await userEvent.click(await screen.findByRole('button', { name: /open folder 15/i }));
  await screen.findByText('clip.mp4');

  fetchMock.mockClear();
  await userEvent.click(screen.getByRole('button', { name: /^07$/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`dir=${encodeURIComponent('2026/07')}`),
      expect.anything(),
    );
  });
  expect(await screen.findByRole('button', { name: /open folder 15/i })).toBeInTheDocument();
});
