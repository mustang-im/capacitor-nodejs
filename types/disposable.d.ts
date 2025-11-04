// Type definitions for Symbol.dispose and Symbol.asyncDispose
// These are needed for TypeScript < 5.2 compatibility with @types/node

declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }

  interface Disposable {
    [Symbol.dispose](): void;
  }

  interface AsyncDisposable {
    [Symbol.asyncDispose](): Promise<void>;
  }
}

export {};

