# subresource-integrity-verifier

Node.js 离线子资源完整性（Subresource Integrity, SRI）验证器。它不发起任何网络请求，
而是基于预先抓取的 HTML、ES module 依赖图、import map、资源内容清单和每个 URL 的
缓存版本，检查所有外部脚本、模块、样式表和字体是否都携带可用的 `integrity`，并且摘要
覆盖的是**重定向之后的最终内容**以及**当前缓存版本**的内容。

## 解决的问题

- 页面虽然启用了 SRI，但动态 `import()` 的模块、CSS `@font-face` / `@import`
  引用的文件没有被 HTML 标签上的完整性声明覆盖。
- CDN 返回 3xx 重定向后，中间错误页/跳转页与最终响应是不同内容；只对中间内容
  计算哈希会产生“校验通过但实际内容已被替换”的假象。
- 同一个 URL 在缓存中保存了多个版本，旧摘要仍然匹配历史响应，导致同一 URL 在
  不同请求中对应不同内容时无法发现篡改。

## 安装与测试

```bash
npm test          # node --test
node bin/sri-verify.js --json example-manifest.json
```

无第三方运行时依赖，仅使用 Node.js 内置模块，要求 Node.js >= 20。

## 编程接口

```js
const { verifyManifest } = require('subresource-integrity-verifier');

const report = verifyManifest(manifest, { minAlgorithm: 'sha256' });
console.log(report.status);            // 'passed' | 'failed'
console.log(report.errors, report.warnings);

// 只有验证通过的资源才能拿到内容，失败的资源调用会抛错，避免内容泄漏
const body = report.getVerifiedContent('https://cdn.test/app.js');
```

## 清单格式

```json
{
  "url": "https://example.test/app/index.html",
  "html": "<script src=\"./app.js\" type=\"module\" integrity=\"sha256-...\"></script>",
  "importMap": {
    "imports": { "vendor": "https://cdn.test/vendor/index.js" },
    "scopes": { "https://example.test/app/feature/": { "vendor": "https://cdn.test/vendor/v2.js" } },
    "integrity": { "https://cdn.test/vendor/index.js": "sha256-..." }
  },
  "moduleGraph": {
    "https://example.test/app/app.js": {
      "imports": ["./dep.js"],
      "dynamicImports": ["./lazy.js"],
      "integrity": "sha256-..."
    }
  },
  "resources": {
    "https://example.test/app/app.js": {
      "body": "文件内容（字符串或 base64/字节数组）",
      "finalUrl": "https://cdn.example.test/app.js",
      "redirects": [
        { "url": "https://example.test/app/app.js", "status": 302, "body": "中间跳转页" },
        { "url": "https://cdn.example.test/app.js", "status": 200, "body": "最终内容" }
      ],
      "fetchFailed": false
    }
  },
  "cacheVersions": {
    "https://example.test/app/app.js": {
      "currentVersion": "v2",
      "versions": [
        { "version": "v1", "body": "历史缓存内容" },
        { "version": "v2", "body": "当前缓存内容" }
      ]
    }
  }
}
```

- `html`：入口页面源码。扫描 `<script src>`、`<link rel=stylesheet>`、
  `rel=preload/modulepreload` 以及内联 `application/importmap`。
- `moduleGraph`：以模块 URL 为键，`imports` 是静态依赖，`dynamicImports` 是
  动态 `import()` 目标，两者都会被递归校验；循环依赖会被完整遍历并产生警告。
- `importMap`：支持裸标识符别名、前缀别名、`scopes` 作用域覆盖，以及 `integrity`
  字段为没有 HTML 标签的模块补充完整性声明。
- `resources.redirects`：按顺序记录每次跳转。校验只针对最后一跳的响应体；
  如果摘要匹配的是中间跳转会报 `INTERMEDIATE_REDIRECT_MATCH`。
- `cacheVersions`：同一 URL 的多个缓存版本。验证只使用 `currentVersion` 的内容；
  摘要只匹配旧版本时报 `STALE_INTEGRITY`，存在多个版本时额外产生
  `CACHE_MULTIPLE_VERSIONS` 警告。

## 校验规则

- 支持同一资源携带多个哈希（如 `sha256-... sha384-... sha512-...`），默认最低
  强度为 `sha256`，可用 `minAlgorithm: 'sha384' | 'sha512'` 收紧。
- `md5`、`sha1` 以及低于配置下限的算法记为 `WEAK_ALGORITHM` 警告，且不能让资源
  通过校验。
- 严格按 SRI 语法解析 `alg-base64!options` 令牌；base64 必须是规范编码（正确填充、
  可往返、拒绝 URL-safe 变体），否则报 `INVALID_METADATA`。
- 每个外部 URL 至少需要一个达到强度要求的可用摘要，否则报 `MISSING_INTEGRITY`。
- 抓取失败（`fetchFailed`）报 `FETCH_FAILED`，不会把空内容当作合法响应。
- `data:` / `blob:` URL 不是外部子资源，跳过处理。
- CSS 会递归扫描 `@font-face` 中的字体和 `@import` 的样式表（注释会先剥离），
  这些引用同样必须有完整性声明，可通过 preload 链接或清单策略补齐。

## 错误与警告码

| 代码 | 级别 | 含义 |
| --- | --- | --- |
| `MISSING_INTEGRITY` | 错误 | 外部资源没有达到强度要求的可用摘要 |
| `INVALID_METADATA` | 错误 | integrity 令牌语法错误或 base64 非规范 |
| `HASH_MISMATCH` | 错误 | 摘要与最终响应/当前缓存内容不一致 |
| `INTERMEDIATE_REDIRECT_MATCH` | 错误 | 摘要只匹配重定向链中的中间响应 |
| `STALE_INTEGRITY` | 错误 | 摘要只匹配历史缓存版本，不匹配当前版本 |
| `MISSING_RESOURCE` | 错误 | 清单中缺少该 URL 的内容 |
| `MISSING_GRAPH_NODE` | 错误 | 模块图引用了未声明的模块节点 |
| `UNRESOLVED_SPECIFIER` | 错误 | import map 无法解析模块说明符 |
| `FETCH_FAILED` | 错误 | URL 抓取失败，没有可用内容 |
| `UNSUPPORTED_ALGORITHM` | 错误 | 当前 Node 运行时不支持该哈希算法 |
| `INVALID_URL` | 错误 | 相对 URL 无法基于页面基址解析 |
| `WEAK_ALGORITHM` | 警告 | 使用 md5/sha1 或低于配置下限的算法 |
| `UNKNOWN_ALGORITHM` | 警告 | 出现验证器不认识的算法名 |
| `CACHE_MULTIPLE_VERSIONS` | 警告 | 同一 URL 缓存了多个版本 |
| `MODULE_CYCLE` | 警告 | 模块依赖图存在循环引用 |

## 与浏览器原生 SRI 的差异

1. **覆盖范围更广**：浏览器只对携带 `integrity` 属性的 `<script>`/`<link>` 标签
   生效，动态 `import()`、CSS 内部的 `@font-face` 和 `@import` 默认不受标签属性
   保护；本工具会沿模块图和 CSS 递归追踪这些引用并要求完整性声明。
2. **离线快照语义**：浏览器在实时网络响应上执行校验；本工具对预先采集的清单做
   离线审计，能显式建模重定向链和多版本缓存，区分“匹配中间跳转页”“匹配旧缓存”
   与“匹配最终内容”。
3. **多摘要策略更严格**：浏览器按 SRI 规范选择“最强可匹配”的元数据，弱算法会被
   忽略；本工具默认要求每个达到强度要求的摘要都必须匹配，任何强摘要不符即失败，
   以便在审计场景暴露不一致的声明。
4. **失败即不返回内容**：浏览器校验失败时阻止资源执行/渲染；本工具在报告中保留
   错误结构，但 `getVerifiedContent()` 对未通过的资源直接抛错，避免下游代码误用
   未验证的字节。
5. **CSS `@import` 限制**：浏览器的 `@import` 规则不支持 SRI 属性，本工具通过
   清单/策略元数据补齐校验，这属于离线增强而非浏览器原生能力。
6. **解析器是轻量正则实现**：本工具不内置完整 HTML/CSS 解析器，用于处理受控的
   采集快照；面对真实线上页面时，建议由采集器先做规范化解析后再生成清单。
7. **不执行代码**：浏览器会真实加载并执行模块；本工具只遍历给定的依赖图，
   图中遗漏的动态拼接说明符需要采集器保证完整性，工具会对无法解析的说明符报错。
