# 更新日志

## v1.1.0 (2026-05-15)

### 🐛 修复

- 修复 Windows Edge 浏览器上传文件时 `ERR_ACCESS_DENIED` 的问题。Edge 的沙箱 iframe（缺少 `allow-same-origin`）导致 File 对象跨源传输后被 XHR 拒绝，现改为双策略上传：优先尝试原生 multipart 直传，失败后自动回退到 base64 JSON 上传。

### ✨ 新增

- 新增 `POST /upload_base64` API 端点，接受 `{filename, data, path}` JSON 格式的 base64 编码上传。
- 前端上传逻辑新增自动回退机制，直传失败时静默切换 base64 上传，用户无感知。

### ⚠️ 注意

- base64 回退方案适用于 < 20MB 的文件；超大文件建议修复浏览器 iframe sandbox 配置以使用原生 multipart 上传。

---

## v1.0.0 (初始发布)

- 文件浏览、上传（multipart）、下载、删除
- 面包屑导航，目录切换
- 安全防护：路径穿越检测、隐藏文件过滤
