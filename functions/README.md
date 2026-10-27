# CloudBase 云函数（v9 后端）

## 目录结构

```
cloudfunctions/
├── README.md
└── daycell-api/     # HTTP 总入口（骨架：健康检查 + CORS + 404）
    └── index.js
```

## 部署（CloudBase CLI）

```bash
# 在仓库根目录执行；参数是 -e/--env-id（不是 --env）；HTTP 函数必须加 --httpFn
tcb fn deploy daycell-api -e coding-daycell-d3g1vgq8g521cb2a6 --httpFn
```

部署成功后函数 URL 形如：
`https://<envId>-<appId>.service.tcloudbase.com/daycell-api`

## 验证

部署后浏览器直接访问 `<函数URL>/health`，返回：

```json
{"ok":true,"service":"daycell-api","version":"v0.1","time":"..."}
```
