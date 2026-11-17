'use strict';

const { isDataUrl } = require('./integrity');

const TAG_RE = /<(script|link)\b[^>]*?>/gis;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(tagText) {
  const attributes = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(tagText)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = value;
  }
  return attributes;
}

function resolveOrNull(value, baseUrl, errors, tagText) {
  if (!value || isDataUrl(value)) {
    return null;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    errors.push({
      code: 'INVALID_URL',
      message: `cannot resolve URL "${value}"`,
      source: tagText,
    });
    return null;
  }
}

function scanHtml(html, baseUrl, errors) {
  const refs = [];
  let tag;
  TAG_RE.lastIndex = 0;
  while ((tag = TAG_RE.exec(html)) !== null) {
    const tagText = tag[0];
    const tagName = tag[1].toLowerCase();
    const attributes = parseAttributes(tagText);

    if (tagName === 'script') {
      if (attributes.type === 'application/importmap' || attributes.type === 'importmap' || !attributes.src) {
        continue;
      }
      const url = resolveOrNull(attributes.src, baseUrl, errors, tagText);
      if (!url) {
        continue;
      }
      const isModule = (attributes.type || '').toLowerCase() === 'module';
      refs.push({
        url,
        kind: isModule ? 'module' : 'script',
        integrity: attributes.integrity || '',
        source: 'html',
        dynamic: false,
        module: isModule,
      });
      continue;
    }

    const rel = (attributes.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.includes('stylesheet')) {
      const url = resolveOrNull(attributes.href, baseUrl, errors, tagText);
      if (url) {
        refs.push({
          url,
          kind: 'style',
          integrity: attributes.integrity || '',
          source: 'html',
        });
      }
      continue;
    }
    if (rel.includes('preload') || rel.includes('modulepreload')) {
      const asType = (attributes.as || '').toLowerCase();
      const supported = ['script', 'style', 'font'];
      if (!supported.includes(asType)) {
        continue;
      }
      const url = resolveOrNull(attributes.href, baseUrl, errors, tagText);
      if (!url) {
        continue;
      }
      const kind = asType === 'script' ? (rel.includes('modulepreload') ? 'module' : 'script') : asType;
      refs.push({
        url,
        kind,
        integrity: attributes.integrity || '',
        source: 'html-preload',
        module: kind === 'module',
      });
    }
  }
  return refs;
}

function extractImportMaps(html) {
  const maps = [];
  const importMapRe = /<script\b[^>]*?\btype\s*=\s*["'](?:application\/)?importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = importMapRe.exec(html)) !== null) {
    try {
      maps.push(JSON.parse(match[1]));
    } catch {
      const error = new Error('import map script is not valid JSON');
      error.code = 'INVALID_IMPORT_MAP';
      throw error;
    }
  }
  return maps;
}

module.exports = {
  parseAttributes,
  scanHtml,
  extractImportMaps,
};
