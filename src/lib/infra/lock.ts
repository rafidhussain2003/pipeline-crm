// Distributed-lock abstraction. Minimal on purpose: acquire a named lock,
// get back a release function, done. Today's implementation only
// serializes concurrent calls *within this one process* (an async mutex
// per key) — it does NOT coordinate across multiple instances, because
// that requires a real distributed lock (Redis `SET key value NX PX ttl`
// is the standard pattern) which needs Redis to exist first.
//
// This is still useful today: it closes real races between concurrent
// requests hitting the same single process (e.g. two lead-assignment calls
// for the same company at the same instant), which is exactly the
// deployment this app runs under right now (one Render instance). It is
// NOT yet sufficient once a second instance is added — that's the one
// thing to remember when Redis lands and this gets swapped out.
export interface Lock {
  release(): void;
}

export interface DistributedLock {
  // Waits for the lock to be free (no timeout — every current call site
  // holds it only for a short, bounded computation, never across an
  // external network call), then returns a handle to release it.
  acquire(key: string): Promise<Lock>;
  // Convenience: acquire, run `fn`, release — even if `fn` throws.
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

class InProcessLock implements DistributedLock {
  // One promise chain per key — each acquire() attaches itself to the tail
  // of the previous holder's release, so callers queue up in order.
  private tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<Lock> {
    const previousTail = this.tails.get(key) || Promise.resolve();
    let releaseFn!: () => void;
    const thisLockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    // Compute the new tail ONCE and reuse the same reference for both the
    // map entry and the later identity check below — `.then()` returns a
    // new Promise object every time it's called, so comparing two
    // separately-created `.then()` results with `===` would always be
    // false and the map entry would never be cleaned up.
    const newTail = previousTail.then(() => thisLockPromise);
    this.tails.set(key, newTail);
    await previousTail;
    return {
      release: () => {
        releaseFn();
        // Only the last-in-line holder removes the map entry — if someone
        // else has queued up since, `tails.get(key)` now points at their
        // (newer) tail, and their own release() will clean up instead.
        if (this.tails.get(key) === newTail) {
          this.tails.delete(key);
        }
      },
    };
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lock = await this.acquire(key);
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }
}

export const lock: DistributedLock = new InProcessLock();
