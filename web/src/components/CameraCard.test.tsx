import { render, screen } from '@testing-library/react';
import CameraCard from './CameraCard';

const p = {
  id: 'abc', name: 'Front door', createdAt: '2026-07-16',
  storage: { host: 'u1-sub1.your-storagebox.de', port: 21, user: 'u1-sub1', basePath: '/reolink', hasPass: true },
  camera: { uid: 'UID', codec: 'h264', hasPassword: true },
};

it('shows the camera name and links to its detail page', () => {
  render(<CameraCard profile={p} />);
  expect(screen.getByText('Front door')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/profiles/abc');
});
