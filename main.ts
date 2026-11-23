// Entry program for a make.fun video-on-X bounty.
//
// The entry itself is the X post named in POST.json: the house reads that
// post's views and interactions from X. This program therefore only has to do
// one thing — copy POST.json from the bot directory into the output directory
// where the gate looks for it.
//
// Node 22, standard library only, no dependencies.
//
//   MAKEFUN_BOT_DIR=/bot MAKEFUN_OUTPUT_DIR=/output node main.ts
//
// Outside the grader's container:
//
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const source = join(BOT_DIR, 'POST.json');
const target = join(OUTPUT_DIR, 'POST.json');

try {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  copyFileSync(source, target);
  console.log(`POST.json copied: ${source} -> ${target}`);
} catch (err) {
  console.error(`POST.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}
