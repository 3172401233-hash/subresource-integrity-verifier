'use strict';

const {
  parseIntegrityMetadata,
  classifyTokens,
  digestMatches,
  isDataUrl,
} = require('./integrity');
const { resolveResource } = require('./resources');
const { normalizeImportMap, integrityFromImportMap } = require('./import-map');
const { scanHtml, extractImportMaps } = require('./html-scan');
const { scanCss } = require('./css-scan');
const { walkModuleGraph } = require('./module-graph');

const DEFAULT_OPTIONS = {
  minAlgorithm: 'sha256',
};

function verifyManifest(manifest, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const errors = [];
  const warnings = [];
  let baseUrl;
  try {
    baseUrl = new URL(manifest.url || manifest.pageUrl || 'http://localhost/').href;
  } catch {
    errors.push({
      code: 'INVALID_URL',
      message: `manifest url "${manifest.url || manifest.pageUrl}" is not an absolute URL`,
    });
    baseUrl = 'http://localhost/';
  }
  const resources = manifest.resources || {};
  const cache = manifest.cacheVersions || manifest.cache || {};
  const moduleGraph = manifest.moduleGraph || {};
  const refsByUrl = new Map();

  function addRef(ref) {
    if (isDataUrl(ref.url)) {
      return;
    }
    if (!refsByUrl.has(ref.url)) {
      refsByUrl.set(ref.url, { refs: [] });
    }
    refsByUrl.get(ref.url).refs.push(ref);
  }

  let importMap = normalizeImportMap(manifest.importMap || {}, baseUrl);
  try {
    for (const map of extractImportMaps(manifest.html || '')) {
      const normalized = normalizeImportMap(map, baseUrl);
      importMap = {
        imports: { ...importMap.imports, ...normalized.imports },
        scopes: { ...importMap.scopes, ...normalized.scopes },
        integrity: { ...importMap.integrity, ...normalized.integrity },
      };
    }
  } catch (error) {
    errors.push({ code: error.code || 'INVALID_IMPORT_MAP', message: error.message });
  }

  const htmlRefs = scanHtml(manifest.html || '', baseUrl, errors);
  for (const ref of htmlRefs) {
    addRef(ref);
  }

  const moduleSeeds = htmlRefs
    .filter((ref) => ref.module && ref.source === 'html')
    .map((ref) => ref.url);
  for (const url of manifest.entryModules || []) {
    try {
      moduleSeeds.push(new URL(url, baseUrl).href);
    } catch {
      errors.push({ code: 'INVALID_URL', message: `invalid entry module URL "${url}"` });
    }
  }

  const { edges, cycles } = walkModuleGraph([...new Set(moduleSeeds)], moduleGraph, importMap, errors);
  for (const cycle of cycles) {
    warnings.push({
      code: 'MODULE_CYCLE',
      message: `module cycle detected at ${cycle.url}${cycle.importer ? ` (via ${cycle.importer})` : ''}`,
      url: cycle.url,
    });
  }
  for (const edge of edges) {
    addRef({
      url: edge.url,
      kind: 'module',
      integrity: edge.integrity,
      source: edge.importer ? (edge.dynamic ? 'dynamic-import' : 'module-graph') : 'module-entry',
      dynamic: edge.dynamic,
      module: true,
    });
  }

  const resolve = (url) => resolveResource(url, resources, cache);

  for (const ref of htmlRefs.filter((entry) => entry.kind === 'style')) {
    const result = scanCss(ref.url, resolve);
    for (const cssRef of result.refs) {
      addRef(cssRef);
    }
    errors.push(...result.errors);
  }

  const results = {};

  for (const [url, entry] of refsByUrl) {
    const resourceResult = {
      url,
      kind: entry.refs[0].kind,
      references: entry.refs.map((ref) => ({
        kind: ref.kind,
        source: ref.source,
        dynamic: Boolean(ref.dynamic),
        integrity: ref.integrity || '',
      })),
      status: 'failed',
      matchedAlgorithms: [],
      warnings: [],
      errors: [],
    };

    const localErrors = [];
    const localWarnings = [];

    const metadataStrings = entry.refs
      .map((ref) => ref.integrity)
      .filter((value) => value && value.trim() !== '');
    const importMapIntegrity = integrityFromImportMap(importMap, url);
    if (importMapIntegrity) {
      metadataStrings.push(importMapIntegrity);
    }

    const allTokens = [];
    for (const metadata of metadataStrings) {
      const parsed = parseIntegrityMetadata(metadata);
      for (const raw of parsed.malformed) {
        localErrors.push({
          code: 'INVALID_METADATA',
          message: `integrity token "${raw}" is malformed or not valid base64`,
          url,
        });
      }
      allTokens.push(...parsed.tokens);
    }

    const { strong, weak, unknown } = classifyTokens(allTokens, settings.minAlgorithm);
    for (const token of weak) {
      localWarnings.push({
        code: 'WEAK_ALGORITHM',
        message: `integrity algorithm ${token.algorithm} for ${url} is below ${settings.minAlgorithm}`,
        url,
        algorithm: token.algorithm,
      });
    }
    for (const token of unknown) {
      localWarnings.push({
        code: 'UNKNOWN_ALGORITHM',
        message: `integrity algorithm ${token.algorithm} for ${url} is not supported by this verifier`,
        url,
        algorithm: token.algorithm,
      });
    }

    const resolved = resolve(url);
    if (resolved.missing) {
      localErrors.push({
        code: 'MISSING_RESOURCE',
        message: `no content manifest entry exists for ${url}`,
        url,
      });
    } else if (resolved.fetchFailed) {
      localErrors.push({
        code: 'FETCH_FAILED',
        message: `the URL failed to fetch and therefore returned no content for ${url}`,
        url,
      });
    }

    if (strong.length === 0 && !resolved.missing && !resolved.fetchFailed) {
      localErrors.push({
        code: 'MISSING_INTEGRITY',
        message: `no usable integrity metadata (minimum ${settings.minAlgorithm}) for ${url}`,
        url,
      });
    }

    if (resolved.versions && resolved.versions.length > 1) {
      localWarnings.push({
        code: 'CACHE_MULTIPLE_VERSIONS',
        message: `${url} has ${resolved.versions.length} cached versions; verification uses version "${resolved.currentVersion}"`,
        url,
        currentVersion: resolved.currentVersion,
      });
    }

    if (!resolved.missing && !resolved.fetchFailed && strong.length > 0) {
      for (const token of strong) {
        const match = digestMatches(resolved.body, token);
        if (match.unsupported) {
          localErrors.push({
            code: 'UNSUPPORTED_ALGORITHM',
            message: `hash algorithm ${token.algorithm} is not available in this Node runtime`,
            url,
          });
          continue;
        }
        if (match.matched) {
          resourceResult.matchedAlgorithms.push(token.algorithm);
          continue;
        }

        const intermediateMatch = (resolved.redirects || []).slice(0, -1).some((hop) => {
          if (hop.body === null) {
            return false;
          }
          return digestMatches(hop.body, token).matched;
        });
        if (intermediateMatch) {
          localErrors.push({
            code: 'INTERMEDIATE_REDIRECT_MATCH',
            message: `integrity for ${url} matches an intermediate redirect body, not the final content`,
            url,
            algorithm: token.algorithm,
          });
          continue;
        }

        const staleMatch = (resolved.versions || [])
          .filter((version) => version.version !== resolved.currentVersion && version.body !== null)
          .some((version) => digestMatches(version.body, token).matched);
        if (staleMatch) {
          localErrors.push({
            code: 'STALE_INTEGRITY',
            message: `integrity for ${url} matches an outdated cached version instead of version "${resolved.currentVersion}"`,
            url,
            algorithm: token.algorithm,
            currentVersion: resolved.currentVersion,
          });
          continue;
        }

        localErrors.push({
          code: 'HASH_MISMATCH',
          message: `${token.algorithm} digest for ${url} does not match the final fetched content`,
          url,
          algorithm: token.algorithm,
        });
      }
    }

    resourceResult.warnings = localWarnings;
    resourceResult.errors = localErrors;
    resourceResult.finalUrl = resolved.finalUrl || null;
    resourceResult.currentVersion = resolved.currentVersion || null;
    resourceResult.status = localErrors.length === 0 ? 'passed' : 'failed';

    errors.push(...localErrors);
    warnings.push(...localWarnings);
    results[url] = resourceResult;
  }

  const status = errors.length === 0 ? 'passed' : 'failed';
  const report = {
    status,
    pageUrl: baseUrl,
    minAlgorithm: settings.minAlgorithm,
    resourceCount: refsByUrl.size,
    errors,
    warnings,
    resources: results,
  };

  return {
    ...report,
    getVerifiedContent(url) {
      const result = results[url];
      if (!result) {
        throw new Error(`unknown resource ${url}`);
      }
      if (result.status !== 'passed') {
        throw new Error(`content for ${url} is not released because verification failed`);
      }
      const resolved = resolveResource(url, resources, cache);
      if (resolved.missing || resolved.fetchFailed) {
        throw new Error(`content for ${url} is unavailable`);
      }
      return Buffer.from(resolved.body);
    },
  };
}

module.exports = {
  verifyManifest,
};
