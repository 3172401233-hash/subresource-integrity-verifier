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

test('passes when every external script and stylesheet digest matches final content', () => {
  const scriptBody = 'console.log("ok")';
  const cssBody = 'body { color: red; }';
  const manifest = basicManifest({
    html: [
      scriptHtml('./app.js', sri(scriptBody)),
      stylesheetHtml('./styles.css', sri(cssBody)),
    ].join('\n'),
    resources: {
      [`${BASE}app.js`]: { body: scriptBody },
      [`${BASE}styles.css`]: { body: cssBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resourceCount, 2);
});

test('supports multiple hashes and selects the strongest acceptable algorithm', () => {
  const body = 'const value = 42;';
  const metadata = `sha256-${hashOf(body)} sha384-${hashOf(body, 'sha384')} sha512-${hashOf(body, 'sha512')}`;
  const manifest = basicManifest({
    html: scriptHtml('./multi.js', metadata),
    resources: { [`${BASE}multi.js`]: { body } },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.resources[`${BASE}multi.js`].matchedAlgorithms.sort(), ['sha256', 'sha384', 'sha512']);
});

test('fails when the final content does not match any digest', () => {
  const body = 'original';
  const manifest = basicManifest({
    html: scriptHtml('./tampered.js', sri(body)),
    resources: { [`${BASE}tampered.js`]: { body: 'replaced' } },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'failed');
  assert.ok(codes(report).includes('HASH_MISMATCH'));
});

test('rejects non-canonical base64 and malformed metadata tokens', () => {
  const manifest = basicManifest({
    html: scriptHtml('./bad.js', 'sha256-abc! sha256-badbase64*'),
    resources: { [`${BASE}bad.js`]: { body: 'x' } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('INVALID_METADATA'));
  assert.ok(codes(report).includes('MISSING_INTEGRITY'));
});

test('rejects base64 with wrong padding even when the alphabet is valid', () => {
  const manifest = basicManifest({
    html: scriptHtml('./pad.js', `sha256-${hashOf('x')}===`),
    resources: { [`${BASE}pad.js`]: { body: 'x' } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('INVALID_METADATA'));
});

test('flags missing integrity as a failure for every external URL', () => {
  const manifest = basicManifest({
    html: [scriptHtml('./no-integrity.js'), stylesheetHtml('./no-integrity.css')].join('\n'),
    resources: {
      [`${BASE}no-integrity.js`]: { body: '1' },
      [`${BASE}no-integrity.css`]: { body: 'a{}' },
    },
  });

  const report = verify(manifest);
  assert.equal(codes(report).filter((code) => code === 'MISSING_INTEGRITY').length, 2);
});

test('rejects md5 and sha1 as weak algorithms', () => {
  const body = 'weak';
  const manifest = basicManifest({
    html: scriptHtml('./weak.js', `md5-${hashOf(body, 'md5')} sha1-${hashOf(body, 'sha1')}`),
    resources: { [`${BASE}weak.js`]: { body } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('MISSING_INTEGRITY'));
  assert.ok(warningCodes(report).includes('WEAK_ALGORITHM'));
});

test('respects a configured minimum algorithm strength', () => {
  const body = 'stronger';
  const manifest = basicManifest({
    html: scriptHtml('./strong.js', sri(body, ['sha256'])),
    resources: { [`${BASE}strong.js`]: { body } },
  });

  const report = verify(manifest, { minAlgorithm: 'sha384' });
  assert.ok(codes(report).includes('MISSING_INTEGRITY'));
  assert.ok(warningCodes(report).includes('WEAK_ALGORITHM'));
});

test('weak digest cannot pass a resource even if it matches the content', () => {
  const body = 'weak-match';
  const manifest = basicManifest({
    html: scriptHtml('./weak-match.js', `sha1-${hashOf(body, 'sha1')}`),
    resources: { [`${BASE}weak-match.js`]: { body } },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.resources[`${BASE}weak-match.js`].matchedAlgorithms, []);
});

test('one bad digest among multiple good digests fails the resource', () => {
  const body = 'multi-bad';
  const metadata = `sha256-${hashOf(body)} sha384-${hashOf('different', 'sha384')}`;
  const manifest = basicManifest({
    html: scriptHtml('./multi-bad.js', metadata),
    resources: { [`${BASE}multi-bad.js`]: { body } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('HASH_MISMATCH'));
  assert.equal(report.status, 'failed');
});

test('does not release content for failed resources but releases verified buffers', () => {
  const goodBody = 'good';
  const badBody = 'bad';
  const goodUrl = `${BASE}good.js`;
  const badUrl = `${BASE}bad.js`;
  const manifest = basicManifest({
    html: [scriptHtml('./good.js', sri(goodBody)), scriptHtml('./bad.js', sri('other'))].join('\n'),
    resources: {
      [goodUrl]: { body: goodBody },
      [badUrl]: { body: badBody },
    },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'failed');
  assert.equal(report.getVerifiedContent(goodUrl).toString(), goodBody);
  assert.throws(() => report.getVerifiedContent(badUrl), /not released/);
});

test('duplicate references to the same URL share one verification result', () => {
  const body = 'duplicate';
  const url = `${BASE}dup.js`;
  const manifest = basicManifest({
    html: [scriptHtml('./dup.js', sri(body)), `<script src="./dup.js" integrity="${sri(body)}"></script>`].join('\n'),
    resources: { [url]: { body } },
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[url].references.length, 2);
});

test('fetch failures are reported and never treated as empty content', () => {
  const manifest = basicManifest({
    html: scriptHtml('./down.js', sri('anything')),
    resources: { [`${BASE}down.js`]: { fetchFailed: true } },
  });

  const report = verify(manifest);
  assert.ok(codes(report).includes('FETCH_FAILED'));
});

test('data URLs are skipped because they carry no external subresource', () => {
  const manifest = basicManifest({
    html: '<script src="data:text/javascript,console.log(1)"></script>',
  });

  const report = verify(manifest);
  assert.equal(report.status, 'passed');
  assert.equal(report.resourceCount, 0);
});
