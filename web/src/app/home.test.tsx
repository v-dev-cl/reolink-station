import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import Home from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

it('renders the home landmark', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  render(<Home />);
  expect(screen.getByTestId('home')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('No cameras yet.')).toBeInTheDocument());
  vi.unstubAllGlobals();
});
