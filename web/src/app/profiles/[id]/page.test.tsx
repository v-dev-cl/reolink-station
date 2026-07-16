import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import ProfileDetail from './page';

afterEach(() => vi.unstubAllGlobals());

// Next's app router wraps route segments that call React's use() in a Suspense
// boundary automatically; rendering the raw component here needs one supplied
// manually. The initial render must also be wrapped in an awaited `act` — the
// synchronous suspend triggered by use(params) otherwise never gets pinged to
// retry once the params promise settles, and the fallback sticks forever.
async function renderDetail(id: string) {
  await act(async () => {
    render(
      <Suspense fallback={<div>route-loading</div>}>
        <ProfileDetail params={Promise.resolve({ id })} />
      </Suspense>,
    );
  });
}

it('shows the not-found/no-access alert (not an infinite spinner) when the profile fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  await renderDetail('x');
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t be loaded/i);
  expect(screen.queryByText(/^loading/i)).not.toBeInTheDocument();
});

it('renders the profile once the fetch succeeds', async () => {
  const profile = {
    id: 'x', name: 'Front door', createdAt: '2026-07-16',
    storage: { host: 'h', port: 21, user: 'u', basePath: '/reolink', hasPass: true },
    camera: { uid: 'UID', codec: 'h264', hasPassword: true },
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(profile), { status: 200 })));
  await renderDetail('x');
  expect(await screen.findByText('Front door')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /view recordings/i }))
    .toHaveAttribute('href', expect.stringMatching(/\/profiles\/.+\/recordings$/));
});
