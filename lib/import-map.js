'use strict';

function normalizeImportMap(importMap, baseUrl) {
  const map = importMap || {};
  const imports = map.imports || {};
  const scopes = map.scopes || {};
  const integrity = map.integrity || {};

  const resolvedImports = {};
  for (const [specifier, target] of Object.entries(imports)) {
    try {
      resolvedImports[specifier] = new URL(target, baseUrl).href;
    } catch {
      resolvedImports[specifier] = target;
    }
  }

  const resolvedScopes = {};
  for (const [scope, mapping] of Object.entries(scopes)) {
    let resolvedScope;
    try {
      resolvedScope = new URL(scope, baseUrl).href;
    } catch {
      resolvedScope = scope;
    }
    const resolvedMapping = {};
    for (const [specifier, target] of Object.entries(mapping || {})) {
      try {
        resolvedMapping[specifier] = new URL(target, baseUrl).href;
      } catch {
        resolvedMapping[specifier] = target;
      }
    }
    resolvedScopes[resolvedScope] = resolvedMapping;
  }

  return { imports: resolvedImports, scopes: resolvedScopes, integrity };
}

function scopeApplies(scopeUrl, importerUrl) {
  if (scopeUrl === importerUrl) {
    return true;
  }
  return importerUrl.startsWith(scopeUrl.endsWith('/') ? scopeUrl : `${scopeUrl}/`);
}

function resolveSpecifier(specifier, importerUrl, importMap) {
  if (/^https?:\/\//i.test(specifier) || specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
    return new URL(specifier, importerUrl).href;
  }
  const scopes = importMap.scopes || {};
  const matchingScopes = Object.keys(scopes)
    .filter((scope) => scopeApplies(scope, importerUrl))
    .sort((left, right) => right.length - left.length);
  for (const scope of matchingScopes) {
    const mapping = scopes[scope];
    if (Object.prototype.hasOwnProperty.call(mapping, specifier)) {
      return mapping[specifier];
    }
    const prefixMatch = Object.keys(mapping)
      .filter((key) => key.endsWith('/') && specifier.startsWith(key))
      .sort((left, right) => right.length - left.length)[0];
    if (prefixMatch) {
      return new URL(specifier.slice(prefixMatch.length), mapping[prefixMatch]).href;
    }
  }
  const imports = importMap.imports || {};
  if (Object.prototype.hasOwnProperty.call(imports, specifier)) {
    return imports[specifier];
  }
  const prefixMatch = Object.keys(imports)
    .filter((key) => key.endsWith('/') && specifier.startsWith(key))
    .sort((left, right) => right.length - left.length)[0];
  if (prefixMatch) {
    return new URL(specifier.slice(prefixMatch.length), imports[prefixMatch]).href;
  }
  const error = new Error(`specifier "${specifier}" cannot be resolved from ${importerUrl}`);
  error.code = 'UNRESOLVED_SPECIFIER';
  throw error;
}

function integrityFromImportMap(importMap, resolvedUrl) {
  const integrity = importMap.integrity || {};
  if (Object.prototype.hasOwnProperty.call(integrity, resolvedUrl)) {
    return integrity[resolvedUrl];
  }
  const keys = Object.keys(integrity)
    .filter((key) => key.endsWith('/') && resolvedUrl.startsWith(key))
    .sort((left, right) => right.length - left.length);
  for (const key of keys) {
    const value = integrity[key];
    if (typeof value === 'string') {
      return value;
    }
    const suffix = resolvedUrl.slice(key.length);
    if (Object.prototype.hasOwnProperty.call(value, suffix)) {
      return value[suffix];
    }
  }
  return null;
}

module.exports = {
  normalizeImportMap,
  resolveSpecifier,
  integrityFromImportMap,
};
