import { TtlCache } from './recordings.cache';

describe('TtlCache', () => {
  it('returns a cached value within ttl and misses after invalidate', () => {
    const c = new TtlCache<number>(1000);
    c.set('profile-1:a', 5);
    expect(c.get('profile-1:a')).toBe(5);
    c.invalidate('profile-1:');
    expect(c.get('profile-1:a')).toBeUndefined();
  });
  it('does not leak across prefixes on invalidate', () => {
    const c = new TtlCache<number>(1000);
    c.set('profile-1:a', 1); c.set('profile-2:a', 2);
    c.invalidate('profile-1:');
    expect(c.get('profile-2:a')).toBe(2);
  });
});
