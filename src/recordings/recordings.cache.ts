export class TtlCache<T> {
  private readonly store = new Map<string, { val: T; exp: number }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp < now()) { this.store.delete(key); return undefined; }
    return e.val;
  }
  set(key: string, val: T): void { this.store.set(key, { val, exp: now() + this.ttlMs }); }
  invalidate(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }
}
function now(): number { return Date.now(); }
