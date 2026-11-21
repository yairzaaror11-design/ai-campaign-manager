'use strict';
// Runs the unit/integration tests. In CI all test files share ONE Postgres, so files run one at a
// time there (parallel files deadlocked and collided on shared rows). Locally each file gets its own
// in-memory database, so files keep running in parallel.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('tests', f));
const args = ['--test'];
if (process.env.CI || process.env.TEST_SERIAL === 'true') args.push('--test-concurrency=1');
const r = spawnSync(process.execPath, [...args, ...files], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status ?? 1);
