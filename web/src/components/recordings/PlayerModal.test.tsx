import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PlayerModal from './PlayerModal';

const vid = { name: 'clip.mp4', path: '2026/07/15/clip.mp4', type: 'file' as const, size: 5, mtime: 0 };
const img = { name: 'shot.jpg', path: '2026/07/15/shot.jpg', type: 'file' as const, size: 2, mtime: 0 };

it('renders a video element with the file url for mp4', () => {
  render(<PlayerModal profileId="p1" entry={vid} onClose={vi.fn()} />);
  expect(screen.getByTestId('player')).toHaveAttribute(
    'src', '/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fclip.mp4',
  );
});

it('renders an img (not video) for jpg', () => {
  render(<PlayerModal profileId="p1" entry={img} onClose={vi.fn()} />);
  expect(screen.getByRole('img')).toBeInTheDocument();
  expect(screen.queryByTestId('player')).not.toBeInTheDocument();
});

it('close button calls onClose', async () => {
  const onClose = vi.fn();
  render(<PlayerModal profileId="p1" entry={vid} onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});
