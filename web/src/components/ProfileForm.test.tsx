import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ProfileForm from './ProfileForm';

it('creates a profile with the entered values', async () => {
  const spy = vi.fn(async () => new Response('{"id":"1"}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  const onDone = vi.fn();
  render(<ProfileForm mode="create" onDone={onDone} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'Front door');
  await userEvent.type(screen.getByLabelText(/^host/i), 'u1-sub1.your-storagebox.de');
  await userEvent.type(screen.getByLabelText(/storage user/i), 'u1-sub1');
  await userEvent.type(screen.getByLabelText(/storage password/i), 'sPASS');
  await userEvent.type(screen.getByLabelText(/base path/i), '/reolink');
  await userEvent.type(screen.getByLabelText(/camera uid/i), 'UID');
  await userEvent.type(screen.getByLabelText(/camera password/i), 'cPASS');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  const body = JSON.parse(spy.mock.calls[0][1].body);
  expect(body).toMatchObject({ name: 'Front door', storage: { host: 'u1-sub1.your-storagebox.de', user: 'u1-sub1', pass: 'sPASS', basePath: '/reolink' }, camera: { uid: 'UID', password: 'cPASS' } });
  expect(onDone).toHaveBeenCalled();
});

it('omits a blank secret on edit (keep-stored)', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  render(<ProfileForm mode="edit" profileId="p1" initial={{
    name: 'Cam', storage: { host: 'h', port: 21, user: 'u', basePath: '/reolink', hasPass: true },
    camera: { uid: 'UID', codec: 'h264', hasPassword: true },
  }} onDone={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  const body = JSON.parse(spy.mock.calls[0][1].body);
  expect(body.storage.pass).toBeUndefined();
  expect(body.camera.password).toBeUndefined();
});
