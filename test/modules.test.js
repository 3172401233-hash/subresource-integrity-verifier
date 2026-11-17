'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE,
  sri,
  scriptHtml,
  basicManifest,
  verify,
  codes,
  warningCodes,
} = require('./helpers');

const appUrl = `${BASE}app.js`;
const depUrl = `${BASE}dep.js`;
const dynamicUrl = `${BASE}lazy.js`;

function moduleManifest(extra = {}) {
  return basicManifest({
    html: scriptHtml('./app.js', '', { module: true }),
    ...extra,
  });
}

test('verifies static module graph dependencies reachable from the entry module', () => {
  const appBody = 'import "./dep.js";';
  const depBody = 'export const value = 1;';
  const manifest = moduleManifest({
    html: scriptHtml('./app.js', sri(appBody), { module: true }),
    moduleGraph: {
      [appUrl]: { imports: ['./dep.js'], integrity: sri(appBody) },
      [depUrl]: { integrity: sri(depBody) },
    },
    resources: {
      [appUrl]: { body: appBody },
      [depUrl]: { body: depBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[depUrl].status, 'passed');
});

test('dynamic import targets are included even though the HTML only sees the entry', () => {
  const appBody = 'const lazy = () => import("./lazy.js");';
  const lazyBody = 'export default function () {}';
  const manifest = moduleManifest({
    html: scriptHtml('./app.js', sri(appBody), { module: true }),
    moduleGraph: {
      [appUrl]: { dynamicImports: ['./lazy.js'], integrity: sri(appBody) },
      [dynamicUrl]: { integrity: sri(lazyBody) },
    },
    resources: {
      [appUrl]: { body: appBody },
      [dynamicUrl]: { body: lazyBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  const ref = report.resources[dynamicUrl].references[0];
  assert.equal(ref.source, 'dynamic-import');
  assert.equal(ref.dynamic, true);
});

test('dynamic import without integrity fails instead of bypassing SRI', () => {
  const appBody = 'import("./lazy.js")';
  const manifest = moduleManifest({
    html: scriptHtml('./app.js', sri(appBody), { module: true }),
    moduleGraph: {
      [appUrl]: { dynamicImports: ['./lazy.js'], integrity: sri(appBody) },
      [dynamicUrl]: {},
    },
    resources: {
      [appUrl]: { body: appBody },
      [dynamicUrl]: { body: 'export default 1' },
    },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('MISSING_INTEGRITY'));
  assert.equal(report.resources[dynamicUrl].status, 'failed');
});

test('resolves bare specifiers through import map aliases and import map integrity', () => {
  const vendorUrl = 'https://cdn.test/vendor/2.0.0/index.js';
  const appBody = 'import "vendor";';
  const vendorBody = 'export default "vendor";';
  const manifest = moduleManifest({
    html: scriptHtml('./app.js', sri(appBody), { module: true }),
    importMap: {
      imports: { vendor: vendorUrl },
      integrity: { [vendorUrl]: sri(vendorBody) },
    },
    moduleGraph: {
      [appUrl]: { imports: ['vendor'], integrity: sri(appBody) },
      [vendorUrl]: {},
    },
    resources: {
      [appUrl]: { body: appBody },
      [vendorUrl]: { body: vendorBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.ok(report.resources[vendorUrl]);
});

test('scoped import map entries override the global alias inside the scope', () => {
  const v1 = 'https://cdn.test/lib/1/index.js';
  const v2 = 'https://cdn.test/lib/2/index.js';
  const scopedImporter = 'https://example.test/app/feature/page.js';
  const manifest = basicManifest({
    importMap: {
      imports: { lib: v1 },
      scopes: {
        'https://example.test/app/feature/': { lib: v2 },
      },
    },
    entryModules: ['./feature/page.js'],
    moduleGraph: {
      [scopedImporter]: { imports: ['lib'], integrity: sri('page') },
      [v2]: { integrity: sri('v2') },
    },
    resources: {
      [scopedImporter]: { body: 'page' },
      [v2]: { body: 'v2' },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.ok(report.resources[v2]);
  assert.equal(report.resources[v1], undefined);
});

test('import map prefix aliases resolve deep specifiers', () => {
  const prefixTarget = 'https://cdn.test/pkg/';
  const deepUrl = 'https://cdn.test/pkg/util/helper.js';
  const manifest = basicManifest({
    importMap: { imports: { 'pkg/': prefixTarget } },
    entryModules: ['./app.js'],
    moduleGraph: {
      [appUrl]: { imports: ['pkg/util/helper.js'], integrity: sri('app') },
      [deepUrl]: { integrity: sri('helper') },
    },
    resources: {
      [appUrl]: { body: 'app' },
      [deepUrl]: { body: 'helper' },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.ok(report.resources[deepUrl]);
});

test('module cycles are traversed completely and reported as warnings', () => {
  const aUrl = `${BASE}cycle-a.js`;
  const bUrl = `${BASE}cycle-b.js`;
  const manifest = basicManifest({
    entryModules: ['./cycle-a.js'],
    moduleGraph: {
      [aUrl]: { imports: ['./cycle-b.js'], integrity: sri('a') },
      [bUrl]: { imports: ['./cycle-a.js'], integrity: sri('b') },
    },
    resources: {
      [aUrl]: { body: 'a' },
      [bUrl]: { body: 'b' },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.ok(warningCodes(report).includes('MODULE_CYCLE'));
  assert.ok(report.resources[aUrl]);
  assert.ok(report.resources[bUrl]);
});

test('unresolved specifiers and missing graph nodes are explicit failures', () => {
  const manifest = moduleManifest({
    html: scriptHtml('./app.js', sri('app'), { module: true }),
    moduleGraph: {
      [appUrl]: { imports: ['ghost'], integrity: sri('app') },
    },
    resources: { [appUrl]: { body: 'app' } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('UNRESOLVED_SPECIFIER'));
});

test('inline import maps in the HTML are parsed and used for resolution', () => {
  const target = 'https://cdn.test/inline/index.js';
  const html = [
    '<script type="importmap">{"imports":{"inline":"https://cdn.test/inline/index.js"}}</script>',
    scriptHtml('./app.js', sri('app'), { module: true }),
  ].join('');
  const manifest = basicManifest({
    html,
    moduleGraph: {
      [appUrl]: { imports: ['inline'], integrity: sri('app') },
      [target]: { integrity: sri('target') },
    },
    resources: {
      [appUrl]: { body: 'app' },
      [target]: { body: 'target' },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.ok(report.resources[target]);
});

test('modulepreload links require integrity and verify the same module', () => {
  const body = 'export const preloaded = true;';
  const manifest = basicManifest({
    html: `<link rel="modulepreload" href="./dep.js" as="script" integrity="${sri(body)}">`,
    resources: { [depUrl]: { body } },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[depUrl].kind, 'module');
});
