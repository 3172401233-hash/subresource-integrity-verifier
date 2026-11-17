'use strict';

const fs = require('node:fs');
const { verifyManifest } = require('../lib/verifier');

function main(argv) {
  const args = argv.slice(2);
  const jsonMode = args.includes('--json');
  const minAlgorithmFlag = args.find((arg) => arg.startsWith('--min-algorithm='));
  const minAlgorithm = minAlgorithmFlag ? minAlgorithmFlag.split('=')[1] : undefined;
  const file = args.find((arg) => !arg.startsWith('--'));

  if (!file) {
    process.stderr.write('usage: sri-verify [--json] [--min-algorithm=sha256|sha384|sha512] <manifest.json>\n');
    return 2;
  }

 let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`failed to read manifest: ${error.message}\n`);
    return 2;
  }

  const report = verifyManifest(manifest, minAlgorithm ? { minAlgorithm } : {});

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`SRI verification: ${report.status.toUpperCase()}\n`);
    process.stdout.write(`resources checked: ${report.resourceCount}\n`);
    for (const error of report.errors) {
      process.stdout.write(`  ERROR [${error.code}] ${error.message}\n`);
    }
    for (const warning of report.warnings) {
      process.stdout.write(`  WARN  [${warning.code}] ${warning.message}\n`);
    }
  }
  return report.status === 'passed' ? 0 : 1;
}

process.exit(main(process.argv));
