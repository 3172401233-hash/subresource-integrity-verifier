'use strict';

const { isDataUrl } = require('./integrity');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseUrl(raw) {
  const trimmed = raw.trim();
  const quoted = /^("([^"]*)"|'([^']*)')$/.exec(trimmed);
  return quoted ? quoted[2] ?? quoted[3] : trimmed;
}

function scanCss(stylesheetUrl, resolveResource) {
  const refs = [];
  const seen = new Set();
  const visitedStylesheets = new Set();
  const errors = [];

  function pushRef(ref) {
    const key = `${ref.kind}:${ref.url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(ref);
  }

  function resolve(value, sourceBaseUrl) {
    if (!value || isDataUrl(value)) {
      return null;
    }
    try {
      return new URL(value, sourceBaseUrl).href;
    } catch {
      errors.push({
        code: 'INVALID_URL',
        message: `cannot resolve URL "${value}" in ${sourceBaseUrl}`,
      });
      return null;
    }
  }

  function walk(currentUrl) {
    if (visitedStylesheets.has(currentUrl)) {
      return;
    }
    visitedStylesheets.add(currentUrl);
    const resolved = resolveResource(currentUrl);
    if (!resolved || resolved.missing) {
      errors.push({
        code: 'MISSING_RESOURCE',
        message: `stylesheet content is not available for ${currentUrl}`,
        url: currentUrl,
      });
      return;
    }
    if (resolved.fetchFailed) {
      errors.push({
        code: 'FETCH_FAILED',
        message: `stylesheet fetch failed for ${currentUrl}`,
        url: currentUrl,
      });
      return;
    }
    const clean = stripComments(resolved.body.toString('utf8'));

    const fontFaceRe = /@font-face\s*{([^}]*)}/gis;
    let block;
    while ((block = fontFaceRe.exec(clean)) !== null) {
      const urlRe = /url\(\s*([^)]*?)\s*\)/gis;
      let urlMatch;
      while ((urlMatch = urlRe.exec(block[1])) !== null) {
        const url = resolve(parseUrl(urlMatch[1]), currentUrl);
        if (url) {
          pushRef({ url, kind: 'font', integrity: '', source: 'css' });
        }
      }
    }

    const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)\s;]+))(?:\s*\))?[^;]*;/gis;
    let importMatch;
    const nested = [];
    while ((importMatch = importRe.exec(clean)) !== null) {
      const raw = importMatch[1] ?? importMatch[2] ?? importMatch[3];
      const url = resolve(parseUrl(raw), currentUrl);
      if (url) {
        pushRef({ url, kind: 'style', integrity: '', source: 'css-import' });
        nested.push(url);
      }
    }

    for (const url of nested) {
      walk(url);
    }
  }

  walk(stylesheetUrl);
  return { refs, errors };
}

module.exports = {
  stripComments,
  parseUrl,
  scanCss,
};
