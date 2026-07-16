import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import LoginForm from './LoginForm';

it('submits credentials and calls onSuccess', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"1","email":"a@b.c","role":"user"}', { status: 201 })));
  const onSuccess = vi.fn();
  render(<LoginForm onSuccess={onSuccess} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
  await userEvent.type(screen.getByLabelText(/password/i), 'secret');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(onSuccess).toHaveBeenCalled();
});

it('shows an error on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 401 })));
  render(<LoginForm onSuccess={vi.fn()} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
});
