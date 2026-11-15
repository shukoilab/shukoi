#!/usr/bin/env node

/**
 * @purpose Executable binary entrypoint for create-shukoi.
 * @rationale Dispatches to runCli with process.argv arguments.
 * @invariants Runs CLI and handles unhandled rejections with non-zero exit code.
 */

import { runCli } from '../dist/index.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
