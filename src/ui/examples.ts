import ex1 from '../../examples/01-two-dodges-to-glory.json';
import ex2 from '../../examples/02-blitz-the-carrier.json';
import ex3 from '../../examples/03-short-pass-to-the-end-zone.json';
import ex4 from '../../examples/04-hand-off-and-run.json';
import ex5 from '../../examples/05-loose-ball-in-traffic.json';
import ex6 from '../../examples/06-sideline-crowd-surf.json';
import ex7 from '../../examples/07-stalling-check.json';

export interface ExampleEntry {
  name: string;
  summary: string;
  file: unknown;
}

const raw = [ex1, ex2, ex3, ex4, ex5, ex6, ex7] as Array<{ name: string; notes?: string }>;

export const EXAMPLES: ExampleEntry[] = raw.map((f) => ({ name: f.name, summary: f.notes ?? '', file: f }));
