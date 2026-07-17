import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LivePlayer from './LivePlayer';

it('renders a muted autoplay video at the proxy stream url', () => {
  render(<LivePlayer profileId="p1" />);
  const v = screen.getByTestId('live-video') as HTMLVideoElement;
  expect(v).toHaveAttribute('src', '/api/camera-profiles/p1/live/stream.mp4');
  expect(v).toHaveAttribute('muted');
  expect(v).toHaveAttribute('autoplay');
});

it('shows an error + retry when the stream errors, and retry remounts a fresh video', async () => {
  render(<LivePlayer profileId="p1" />);
  fireEvent.error(screen.getByTestId('live-video'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load the live stream/i);
  await userEvent.click(screen.getByRole('button', { name: /retry/i }));
  // after retry the video is back (error cleared)
  expect(screen.getByTestId('live-video')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
