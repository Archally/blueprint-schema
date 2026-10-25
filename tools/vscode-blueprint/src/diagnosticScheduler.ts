/** A new request invalidates in-flight publication immediately, before its debounce expires. */
export class DiagnosticScheduler<T> {
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private readonly compute: () => Promise<T>,
    private readonly publish: (value: T) => void,
    private readonly failure: (error: unknown) => void = () => {},
  ) {}
  schedule(delay: number): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        const value = await this.compute();
        if (!this.disposed && generation === this.generation) this.publish(value);
      } catch (error) {
        if (!this.disposed && generation === this.generation) this.failure(error);
      }
    }, delay);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
  }
}
