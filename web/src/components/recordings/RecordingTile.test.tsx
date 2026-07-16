import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RecordingTile from './RecordingTile';

const img = { name: 'shot.jpg', path: '2026/07/15/shot.jpg', type: 'file' as const, size: 2, mtime: 0 };
const vid = { name: 'clip.mp4', path: '2026/07/15/clip.mp4', type: 'file' as const, size: 5, mtime: 0 };

it('renders an image thumbnail pointing at the file endpoint', () => {
  render(<RecordingTile profileId="p1" entry={img} selected={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.getByRole('img')).toHaveAttribute(
    'src', '/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fshot.jpg',
  );
});

it('renders a play placeholder (no img) for videos', () => {
  render(<RecordingTile profileId="p1" entry={vid} selected={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('fires onOpen and onToggle independently', async () => {
  const onOpen = vi.fn(); const onToggle = vi.fn();
  render(<RecordingTile profileId="p1" entry={vid} selected={false} onToggle={onToggle} onOpen={onOpen} />);
  await userEvent.click(screen.getByRole('button', { name: /open clip.mp4/i }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('checkbox', { name: /select clip.mp4/i }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledTimes(1); // toggling must not open
});
