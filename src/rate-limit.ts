/** Token bucket: protects the server (and any paid backend behind it) from runaway agent loops. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly capacity: number, private readonly refillPerSecond: number) {
    this.tokens = capacity;
  }

  tryTake(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
