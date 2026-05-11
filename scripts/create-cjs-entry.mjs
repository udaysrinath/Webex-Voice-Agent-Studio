import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");
const entryPath = join(distDir, "index.cjs");

mkdirSync(distDir, { recursive: true });
writeFileSync(
  entryPath,
  `'use strict';

const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

import(pathToFileURL(join(__dirname, 'index.js')).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
`
);
