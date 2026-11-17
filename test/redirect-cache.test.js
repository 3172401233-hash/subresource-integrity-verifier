'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE,
  sri,
  hashOf,
  scriptHtml,
  stylesheetHtml,
  basicManifest,
  verify,
  codes,
  warningCodes,
} = require('./helpers');

test('digest must cover the final redirect body rather than an intermediate page', () => {
  const url = `${BASE}redirect.js`;
  const errorPage = '<html>moved</html>';
  const finalBody = 'export default "final";';
  const manifest = basicManifest({
    html: scriptHtml('./redirect.js', sri(errorPage)),
    resources: {
      [url]: {
        finalUrl: 'https://cdn.test/final/redirect.js',
        redirects: [
          { url, status: 302, body: errorPage },
          { url: 'https://cdn.test/final/redirect.js', status: 200, body: finalBody },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('INTERMEDIATE_REDIRECT_MATCH'));
  assert.equal(report.resources[url].status, 'failed');
});

test('passes when integrity matches the final post-redirect content', () => {
  const url = `${BASE}redirect-ok.js`;
  const finalBody = 'final content';
  const manifest = basicManifest({
    html: scriptHtml('./redirect-ok.js', sri(finalBody)),
    resources: {
      [url]: {
        redirects: [
          { url, status: 307, body: 'hop' },
          { url: 'https://cdn.test/final.js', status: 200, body: finalBody },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[url].finalUrl, 'https://cdn.test/final.js');
});

test('content swapped after redirect yields HASH_MISMATCH when no digest matches', () => {
  const url = `${BASE}swap.js`;
  const original = 'original body';
  const swapped = 'swapped body';
  const manifest = basicManifest({
    html: scriptHtml('./swap.js', sri(original)),
    resources: {
      [url]: {
        redirects: [
          { url, status: 302, body: 'hop' },
          { url: 'https://cdn.test/swap-final.js', status: 200, body: swapped },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('HASH_MISMATCH'));
});

test('old cached digest cannot verify the current cached version', () => {
  const url = `${BASE}cached.js`;
  const oldBody = 'version-one';
  const newBody = 'version-two';
  const manifest = basicManifest({
    html: scriptHtml('./cached.js', sri(oldBody)),
    resources: { [url]: { body: newBody } },
    cacheVersions: {
      [url]: {
        currentVersion: 'v2',
        versions: [
          { version: 'v1', body: oldBody },
          { version: 'v2', body: newBody },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('STALE_INTEGRITY'));
  assert.ok(warningCodes(report).includes('CACHE_MULTIPLE_VERSIONS'));
});

test('cache version matching the current content passes despite other cached versions', () => {
  const url = `${BASE}cached-ok.js`;
  const oldBody = 'old';
  const newBody = 'new';
  const manifest = basicManifest({
    html: scriptHtml('./cached-ok.js', sri(newBody)),
    resources: { [url]: { body: newBody } },
    cacheVersions: {
      [url]: {
        currentVersion: 'v2',
        versions: [
          { version: 'v1', body: oldBody },
          { version: 'v2', body: newBody },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[url].currentVersion, 'v2');
});

test('cache entry pointing only at a failed fetch fails and never returns content', () => {
  const url = `${BASE}offline.js`;
  const manifest = basicManifest({
    html: scriptHtml('./offline.js', sri('whatever')),
    cacheVersions: { [url]: { fetchFailed: true } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('FETCH_FAILED'));
  assert.throws(() => report.getVerifiedContent(url), /unavailable|not released/);
});

test('the same URL with distinct cached versions is flagged as a cache conflict warning', () => {
  const url = `${BASE}versions.js`;
  const manifest = basicManifest({
    html: scriptHtml('./versions.js', sri('current')),
    resources: { [url]: { body: 'current' } },
    cacheVersions: {
      [url]: {
        currentVersion: 'cur',
        versions: [
          { version: 'old', body: 'old' },
          { version: 'cur', body: 'current' },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.ok(warningCodes(report).includes('CACHE_MULTIPLE_VERSIONS'));
});

test('CSS @font-face fonts and @import stylesheets are checked for integrity', () => {
  const cssUrl = `${BASE}styles.css`;
  const fontUrl = `${BASE}fonts/brand.woff2`;
  const importedUrl = `${BASE}base.css`;
  const cssBody = [
    '@font-face { font-family: "Brand"; src: url("./fonts/brand.woff2") format("woff2"); }',
    '@import url("./base.css");',
  ].join('\n');
  const baseCss = 'a { color: inherit; }';
  const fontBody = Buffer.from([0x77, 0x4f, 0x46, 0x32]);

  const manifest = basicManifest({
    html: stylesheetHtml('./styles.css', sri(cssBody)),
    resources: {
      [cssUrl]: { body: cssBody },
      [importedUrl]: { body: baseCss },
      [fontUrl]: { body: fontBody },
    },
  });

  const report = verify(manifest);
  assert.ok(report.resources[fontUrl]);
  assert.ok(report.resources[importedUrl]);
  assert.equal(codes(report).filter((code) => code === 'MISSING_INTEGRITY').length, 2);
  assert.equal(report.resources[fontUrl].kind, 'font');
});

test('font passes when supplied integrity through a preload link', () => {
  const cssUrl = `${BASE}with-font.css`;
  const fontUrl = `${BASE}fonts/ok.woff2`;
  const fontBody = Buffer.from('font-bytes');
  const cssBody = '@font-face { src: url("./fonts/ok.woff2"); }';
  const manifest = basicManifest({
    html: [
      stylesheetHtml('./with-font.css', sri(cssBody)),
      `<link rel="preload" href="./fonts/ok.woff2" as="font" integrity="${sri(fontBody)}">`,
    ].join('\n'),
    resources: {
      [cssUrl]: { body: cssBody },
      [fontUrl]: { body: fontBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[fontUrl].status, 'passed');
});

test('CSS comments are stripped and cannot hide font references', () => {
  const cssUrl = `${BASE}commented.css`;
  const fontUrl = `${BASE}fonts/comment.woff2`;
  const cssBody = '/* @font-face { src: url("./fonts/comment.woff2"); } */';
  const manifest = basicManifest({
    html: stylesheetHtml('./commented.css', sri(cssBody)),
    resources: { [cssUrl]: { body: cssBody } },
  });

  const report = verify(manifest);
  assert.equal(report.resources[fontUrl], undefined);
  assert.equal(report.status, 'passed');
});

test('missing stylesheet content is an error instead of silently skipping references', () => {
  const cssUrl = `${BASE}missing.css`;
  const manifest = basicManifest({
    html: stylesheetHtml('./missing.css', sri('body')),
    resources: {},
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('MISSING_RESOURCE'));
});

test('a referenced URL absent from every manifest is a missing resource failure', () => {
  const manifest = basicManifest({
    html: scriptHtml('./ghost.js', sri('anything')),
    resources: {},
    cacheVersions: {},
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('MISSING_RESOURCE'));
  assert.equal(report.resources[`${BASE}ghost.js`].status, 'failed');
});

test('different cache versions of one URL cannot all verify against the same digest set', () => {
  const url = `${BASE}split.js`;
  const versionA = 'a-content';
  const versionB = 'b-content';
  const manifest = basicManifest({
    html: scriptHtml('./split.js', sri(versionA)),
    resources: { [url]: { body: versionB } },
    cacheVersions: {
      [url]: {
        currentVersion: 'B',
        versions: [
          { version: 'A', body: versionA },
          { version: 'B', body: versionB },
        ],
      },
    },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('STALE_INTEGRITY'));
  assert.equal(hashOf(versionA) !== hashOf(versionB), true);
});
