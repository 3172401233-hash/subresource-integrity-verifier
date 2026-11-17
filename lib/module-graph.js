'use strict';

const { resolveSpecifier } = require('./import-map');

function walkModuleGraph(seedUrls, moduleGraph, importMap, errors) {
  const edges = [];
  const visited = new Set();
  const stack = new Set();
  const cycles = [];

  function visit(url, importer, dynamic) {
    if (visited.has(url)) {
      if (stack.has(url)) {
        cycles.push({ url, importer });
      }
      return;
    }
    visited.add(url);
    stack.add(url);

    const node = moduleGraph && Object.prototype.hasOwnProperty.call(moduleGraph, url) ? moduleGraph[url] : null;
    if (!node) {
      errors.push({
        code: 'MISSING_GRAPH_NODE',
        message: `module graph has no node for ${url}`,
        url,
        importer: importer || null,
      });
      stack.delete(url);
      return;
    }

    edges.push({
      url,
      importer: importer || null,
      dynamic: Boolean(dynamic),
      integrity: node.integrity || '',
    });

    const dependencies = [];
    for (const dep of node.imports || []) {
      dependencies.push({ specifier: dep, dynamic: false });
    }
    for (const dep of node.dynamicImports || []) {
      const specifier = typeof dep === 'string' ? dep : dep.specifier;
      dependencies.push({ specifier, dynamic: true });
    }

    for (const { specifier, dynamic: isDynamic } of dependencies) {
      let resolved;
      try {
        resolved = resolveSpecifier(specifier, url, importMap);
      } catch (error) {
        errors.push({
          code: error.code || 'UNRESOLVED_SPECIFIER',
          message: error.message,
          url,
          specifier,
        });
        continue;
      }
      visit(resolved, url, isDynamic);
    }

    stack.delete(url);
  }

  for (const seed of seedUrls) {
    visit(seed, null, false);
  }

  return { edges, cycles };
}

module.exports = {
  walkModuleGraph,
};
