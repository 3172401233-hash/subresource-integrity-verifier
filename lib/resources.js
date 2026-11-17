'use strict';

function toBuffer(body) {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  throw new TypeError('resource body must be a string, Buffer or Uint8Array');
}

function normalizeRedirectChain(chain) {
  if (!Array.isArray(chain)) {
    return [];
  }
  return chain.map((entry) => ({
    url: entry.url,
    status: entry.status,
    body: entry.body === undefined ? null : toBuffer(entry.body),
  }));
}

function normalizeCachedVersion(version, url) {
  return {
    version: version.version === undefined ? null : String(version.version),
    body: version.body === undefined ? null : toBuffer(version.body),
    finalUrl: version.finalUrl || url,
  };
}

function resolveResource(url, resources, cache) {
  const entry = resources && Object.prototype.hasOwnProperty.call(resources, url) ? resources[url] : null;
  const cacheEntry = cache && Object.prototype.hasOwnProperty.call(cache, url) ? cache[url] : null;

  if (!entry && !cacheEntry) {
    return { missing: true };
  }
  if ((entry && entry.fetchFailed) || (cacheEntry && cacheEntry.fetchFailed && !cacheEntry.currentVersion)) {
    return { fetchFailed: true };
  }

  const redirects = entry ? normalizeRedirectChain(entry.redirects) : [];
  let versions = [];
  if (cacheEntry && Array.isArray(cacheEntry.versions) && cacheEntry.versions.length > 0) {
    versions = cacheEntry.versions.map((version) => normalizeCachedVersion(version, url));
  }
  const currentVersion = cacheEntry && cacheEntry.currentVersion !== undefined
    ? String(cacheEntry.currentVersion)
    : null;

  let body = null;
  if (currentVersion !== null) {
    const hit = versions.find((version) => version.version === currentVersion);
    if (hit && hit.body !== null) {
      body = hit.body;
    }
  }
  if (body === null && entry && entry.body !== undefined) {
    body = toBuffer(entry.body);
  } else if (body === null && entry && redirects.length > 0) {
    const last = redirects[redirects.length - 1];
    if (last && last.body !== null) {
      body = last.body;
    }
  }
  if (body === null) {
    return { fetchFailed: true, versions, redirects, finalUrl: entry ? entry.finalUrl || url : url };
  }

  const finalUrl = entry && entry.finalUrl
    ? entry.finalUrl
    : redirects.length > 0
      ? redirects[redirects.length - 1].url
      : url;

  return {
    missing: false,
    fetchFailed: false,
    body,
    finalUrl,
    redirects,
    versions,
    currentVersion,
  };
}

module.exports = {
  toBuffer,
  normalizeRedirectChain,
  resolveResource,
};
