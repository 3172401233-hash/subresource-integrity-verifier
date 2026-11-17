'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');

const STRENGTH_ORDER = ['sha256', 'sha384', 'sha512'];
const WEAK_ALGORITHMS = ['md5', 'sha1'];

const TOKEN_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*)-([A-Za-z0-9+/]+={0,2})([!-~]*)?$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isDataUrl(url) {
  return /^data:/i.test(url) || /^blob:/i.test(url);
}

function decodeBase64Digest(digest) {
  if (!BASE64_RE.test(digest)) {
    return null;
  }
  let binary;
  try {
    binary = Buffer.from(digest, 'base64');
  } catch {
    return null;
  }
  const pad = digest.endsWith('==') ? 2 : digest.endsWith('=') ? 1 : 0;
  const expectedLength = digest.length - pad;
  const validLength = Math.floor((expectedLength + 2) / 4) * 3 - (pad === 2 ? 2 : pad === 1 ? 1 : 0);
  if (binary.length !== validLength) {
    return null;
  }
  if (binary.toString('base64') !== digest) {
    return null;
  }
  return binary;
}

function parseIntegrityMetadata(metadata) {
  const tokens = [];
  const malformed = [];
  if (metadata === undefined || metadata === null || String(metadata).trim() === '') {
    return { tokens, malformed };
  }
  for (const rawToken of String(metadata).trim().split(/\s+/)) {
    const match = TOKEN_RE.exec(rawToken);
    if (!match) {
      malformed.push(rawToken);
      continue;
    }
    const [, algo, digest, options = ''] = match;
    const digestBytes = decodeBase64Digest(digest);
    if (!digestBytes) {
      malformed.push(rawToken);
      continue;
    }
    tokens.push({
      raw: rawToken,
      algorithm: algo.toLowerCase(),
      digestBase64: digest,
      digestBytes,
      options,
    });
  }
  return { tokens, malformed };
}

function hashBody(body, algorithm) {
  return createHash(algorithm).update(body).digest();
}

function digestMatches(body, token) {
  let actual;
  try {
    actual = hashBody(body, token.algorithm);
  } catch {
    return { matched: false, unsupported: true };
  }
  if (actual.length !== token.digestBytes.length) {
    return { matched: false, unsupported: false };
  }
  return { matched: timingSafeEqual(actual, token.digestBytes), unsupported: false };
}

function meetsStrength(algorithm, minAlgorithm) {
  const minimum = STRENGTH_ORDER.indexOf(minAlgorithm);
  const current = STRENGTH_ORDER.indexOf(algorithm);
  if (minimum === -1 || current === -1) {
    return false;
  }
  return current >= minimum;
}

function classifyTokens(tokens, minAlgorithm) {
  const strong = [];
  const weak = [];
  const unknown = [];
  for (const token of tokens) {
    if (WEAK_ALGORITHMS.includes(token.algorithm)) {
      weak.push(token);
    } else if (meetsStrength(token.algorithm, minAlgorithm)) {
      strong.push(token);
    } else if (STRENGTH_ORDER.includes(token.algorithm)) {
      weak.push(token);
    } else {
      unknown.push(token);
    }
  }
  return { strong, weak, unknown };
}

module.exports = {
  STRENGTH_ORDER,
  WEAK_ALGORITHMS,
  isDataUrl,
  decodeBase64Digest,
  parseIntegrityMetadata,
  hashBody,
  digestMatches,
  meetsStrength,
  classifyTokens,
};
