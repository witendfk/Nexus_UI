/** Lazy host source with direct iterator ownership: return() reaches an in-flight next(). */
export function lazyMessageSource(
  factory: () =>
    | AsyncIterable<unknown>
    | Iterable<unknown>
    | Promise<AsyncIterable<unknown> | Iterable<unknown>>,
  prefix: readonly unknown[] = [],
): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let iterator: AsyncIterator<unknown> | Iterator<unknown> | undefined;
      let opening: Promise<void> | undefined;
      let closed = false;
      let returned: Promise<IteratorResult<unknown>> | undefined;
      let index = 0;
      const close = (): Promise<IteratorResult<unknown>> => {
        closed = true;
        returned ??= (async () => {
          if (opening) await opening;
          return (await iterator?.return?.()) ?? { done: true, value: undefined };
        })();
        return returned;
      };
      return {
        async next(): Promise<IteratorResult<unknown>> {
          if (closed) return { done: true, value: undefined };
          if (index < prefix.length) return { done: false, value: prefix[index++] };
          opening ??= (async () => {
            const source = await factory();
            iterator =
              Symbol.asyncIterator in source
                ? source[Symbol.asyncIterator]()
                : source[Symbol.iterator]();
          })();
          await opening;
          if (closed) return { done: true, value: undefined };
          const step = await iterator!.next();
          return closed ? { done: true, value: undefined } : step;
        },
        return: close,
      };
    },
  };
}
