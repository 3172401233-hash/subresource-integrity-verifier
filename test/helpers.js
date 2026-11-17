'use strict';

const { createHash } = require('node:crypto');
const { verifyManifest } = require('../index');

const BASE = 'https://example.test/app/';

function hashOf(body, algorithm = 'sha256') {
  return createHash(algorithm).update(body).digest('base64');
}

function sri(body, algorithms = ['sha256']) {
  return algorithms.map((algorithm) => `${algorithm}-${hashOf(body, algorithm)}`).join(' ');
}

function scriptHtml(url, integrity, { module = false } = {}) {
  const type = module ? ' type="module"' : '';
  const integrityAttr = integrity ? ` integrity="${integrity}"` : '';
  return `<script src="${url}"${type}${integrityAttr}></script>`;
}

function stylesheetHtml(url, integrity) {
  const integrityAttr = integrity ? ` integrity="${integrity}"` : '';
  return `<link rel="stylesheet" href="${url}"${integrityAttr}>`;
}

function basicManifest(extra = {}) {
  return {
    url: `${BASE}index.html`,
    html: '',
    importMap: { imports: {}, scopes: {}, integrity: {} },
    moduleGraph: {},
    resources: {},
    cacheVersions: {},
    ...extra,
  };
}

function verify(manifest, options) {
  return verifyManifest(manifest, options);
}

function codes(report) {
  return report.errors.map((error) => error.code);
}

function warningCodes(report) {
  return report.warnings.map((warning) => warning.code);
}

module.exports = {
  BASE,
  hashOf,
  sri,
  scriptHtml,
  stylesheetHtml,
  basicManifest,
  verify,
  codes,
  warningCodes,
};
