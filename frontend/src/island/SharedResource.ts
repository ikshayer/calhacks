/** Effect-owned async resource. A microtask grace period bridges StrictMode cleanup/setup. */
export class SharedResource<T> {
  private entry: { refs: number; promise: Promise<T> } | null = null
  constructor(privateFactory: () => Promise<T>, privateDispose: (value: T) => void) {
    this.factory = privateFactory
    this.dispose = privateDispose
  }
  private readonly factory: () => Promise<T>
  private readonly dispose: (value: T) => void
  acquire(): { ready: Promise<T>; release(): void } {
    const entry = this.entry ??= { refs: 0, promise: this.factory() }
    entry.refs++
    let released = false
    return { ready: entry.promise, release: () => {
      if (released) return
      released = true
      entry.refs--
      queueMicrotask(() => {
        if (entry.refs || this.entry !== entry) return
        this.entry = null
        void entry.promise.then(this.dispose, () => {})
      })
    } }
  }
}
