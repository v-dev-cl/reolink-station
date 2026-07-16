import { render, screen } from '@testing-library/react';
import Home from './page';

it('renders the home landmark', () => {
  render(<Home />);
  expect(screen.getByTestId('home')).toBeInTheDocument();
});
