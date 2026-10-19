declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, message?: string | RegExp | object): void;
    match(value: string, re: RegExp, message?: string): void;
    doesNotMatch(value: string, re: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
declare const process: { env: Record<string, string | undefined>; argv: string[]; exit(code?: number): never };
