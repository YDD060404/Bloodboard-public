declare module 'node:worker_threads' {
  export class Worker {
    constructor(code: string, options?: { eval?: boolean; resourceLimits?: Record<string, number> });
    postMessage(m: unknown): void;
    terminate(): Promise<number>;
    on(ev: string, fn: (...a: any[]) => void): void;
  }
}
declare module 'node:fs' {
  export function readFileSync(p: string, enc?: string): any;
  export function writeFileSync(p: string, data: string): void;
  export function appendFileSync(p: string, data: string): void;
  export function mkdirSync(p: string, o?: { recursive?: boolean }): void;
  export function existsSync(p: string): boolean;
  export function readdirSync(p: string): string[];
  export function renameSync(a: string, b: string): void;
}
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
  export function basename(p: string): string;
  export function dirname(p: string): string;
}
declare module 'node:crypto' {
  export function createHash(alg: string): { update(d: string): any; digest(enc: string): string };
}
declare module 'node:os' {
  export function cpus(): unknown[];
  export function totalmem(): number;
  export function setPriority(pid: number, priority: number): void;
}
declare module 'node:child_process' {
  export function spawn(cmd: string, args: string[], o?: { stdio?: unknown }): {
    stdout: { on(ev: string, fn: (d: any) => void): void };
    stdin: { on(ev: string, fn: (e: any) => void): void; end(data: string): void };
    on(ev: string, fn: (...a: any[]) => void): void;
    kill(): boolean;
    pid?: number;
  };
}
