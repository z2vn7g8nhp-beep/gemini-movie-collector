# 光影志 · CinéArchive（GitHub Web App）

个人影视、影人与角色收藏档案馆，已完整适配 **GitHub Pages 静态部署** 与 **PWA 独立 Web App 安装**（支持 iOS / Android 添加到主屏幕及桌面端独立窗口运行）。

## GitHub Pages 一键部署步骤

1. 将本仓库推送至你的 GitHub 仓库（默认分支为 `main`）。
2. 打开仓库的 **Settings → Pages → Build and deployment**。
3. 将 **Source** 切换为 **GitHub Actions**。
4. 推送代码或在 **Actions** 页面手动触发 `Deploy CineArchive Web App to GitHub Pages` 工作流，构建完成后即可访问 `https://<你的用户名>.github.io/<仓库名>/`。

## 静态 Web App 特性说明

- **相对路径适配**：构建产物采用相对路径（`base: './'`），兼容 GitHub Pages 子路径及自定义域名，同时自动生成 `404.html` 与 `.nojekyll`。
- **无后端纯前端直连模式**：在 GitHub Pages 环境下自动切换为纯浏览器模式——馆藏与打卡数据保存在浏览器本地 `localStorage`（随时支持 JSON 导出与跨设备恢复）；在线搜片、全网选封面、角色设定补全与演职员关系发现会自动通过浏览器直连支持 CORS 的公开接口（番组计划 Bangumi、中文/英文维基百科、维基媒体与 TVMaze）。
- **离线 PWA 支持**：内置 Web App Manifest、多尺寸及安全区 Maskable 图标与 Service Worker 缓存，支持离线翻阅本地藏馆。

## 本地开发与预览

```bash
# 安装依赖
npm install

# 启动完整开发模式（带 Express 服务端代理与本地 JSON 持久化）
npm run dev

# 构建 GitHub Pages 纯静态 Web App 产物（输出至 dist/）
npm run build:gh-pages

# 本地预览静态构建产物
npm run preview
```

### 中文片名搜索

常见影视的中文名、英文名、年份和 IMDb 编号随应用发布，静态版和服务端共用同一份索引。打开应用后，即使外部资料源超时，索引内的影片也可以搜索、收藏。索引外的条目、实时评分、海报、简介和影人资料依赖在线来源。

维护者可运行 `python3 scripts/update-film-index.py` 更新完整索引。候选来自 IMDb 投票数最多的 6,000 个编号及 Cinemeta 当前热门电影、剧集。中文名取自同一 IMDb 编号关联的 Wikidata 实体。GitHub Pages 每次部署及每周一更新热门片名；更新源不可用时，构建使用仓库内的索引。

[IMDb 数据集](https://developer.imdb.com/non-commercial-datasets/) · [Wikidata 数据许可](https://www.wikidata.org/wiki/Wikidata:Licensing)

### 演职员与角色

对带有 IMDb 影片链接的藏品，详情页按影片编号从本站载入导演、编剧、演员和有明确记录的角色，再补充可用的联网资料。各片的署名及角色覆盖取决于数据源；详情页另有 IMDb 完整演职员表入口。打开单部作品时只加载一个资料分片。

运行 `python3 scripts/update-film-credits.py` 可按现有片名索引更新演职员快照。快照使用 Wikidata 的 CC0 结构化数据，支持角色实体及纯文本角色名。[Wikidata 数据许可](https://www.wikidata.org/wiki/Wikidata:Licensing)
