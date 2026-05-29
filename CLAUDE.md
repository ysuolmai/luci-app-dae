# luci-app-dae — Claude 上下文文档

> 供 Claude Code 自动读取。新机器上 git clone 后，Claude 应该靠本文件快速上手。

## 项目简介

[dae](https://github.com/daeuniverse/dae)（基于 eBPF 的 Linux 内核级透明代理）的 LuCI Web UI 与 OpenWrt 打包脚本。**独立仓库**，被 [ysuolmai/OpenWRT-CI](https://github.com/ysuolmai/OpenWRT-CI) 在 `Scripts/diy.sh` 的 `[dae]` 块通过 `git clone` 拉入。

仓库布局：

```
.
├── README.md
├── LICENSE  (Apache-2.0)
├── CLAUDE.md (本文件)
├── .github/workflows/build.yml   # GH Actions：编 .ipk（ImmortalWrt 23.05.4 SDK）
├── dae/                          # dae 主程序包
│   ├── Makefile                  # 从 daeuniverse/dae main 编译（Go + eBPF；2026-05 从 olicesx/kdae 切回上游）
│   └── files/                    # dae UCI config + init 脚本
└── luci-app-dae/                 # LuCI UI
    ├── Makefile
    ├── htdocs/luci-static/resources/view/dae/
    │   ├── config.js             # 主页面（3 tab：表单 / 所有节点 / 文本）
    │   ├── dae-parser.js         # dae DSL parse/serialize（dual-env: LuCI + Node）
    │   ├── settings.js           # 服务设置页（enable / 日志大小）
    │   └── log.js                # 日志查看
    ├── po/
    │   ├── templates/dae.pot     # i18n 模板
    │   └── zh_Hans/dae.po        # 中文翻译
    ├── root/etc/hotplug.d/iface/98-dae   # WAN 拨号触发 dae 重启
    ├── root/usr/lib/luci-app-dae/list-nodes.sh   # 拉订阅 + 解析 base64 URI
    ├── root/usr/share/luci/menu.d/luci-app-dae.json
    ├── root/usr/share/rpcd/acl.d/luci-app-dae.json
    └── tests/
        ├── parser.test.js          # Node.js 内置 assert，49 个测试
        ├── list-nodes.test.sh      # shell + jq，5 个测试
        └── fixtures/sample-sub-plain.txt
```

---

## dae 的配置四层模型（避免重蹈 v1 覆辙）

```
订阅 (subscription) + 手动节点 (node)
   ↓ 合并成全局节点池
group { ... }                         ← 必须！v1 漏掉这一层
   ↓ filter 挑节点 + policy 决定怎么选一个
routing { ... }                       ← action 写 group 名（不是订阅名/节点名）
```

**routing 规则的 action** 只能是：`direct` / `block` / **group 名**。  
不能直接写订阅名或节点名——dae 不认。`_makeActionSelect` 在 config.js 里**只能从 `self._config.groups` 取选项**。

**默认配置**（第一次打开时）：
- 1 个名为 `proxy` 的组，filter 勾选所有当前订阅，排除关键字 `ExpireAt`，策略 `min_moving_avg`
- routing 预填 5 条 `direct` 规则 + `fallback → proxy`，**前两条是打破 DNS 死锁的关键**：
  - `pname(dae) -> direct`：dae 自身控制面流量直连
  - `dip(8.8.8.8, 114.114.114.114) -> direct`：DNS upstream 强制直连
- DNS 预填 IP 字面量 upstream：`alidns: udp://114.114.114.114:53`、`googledns: udp://8.8.8.8:53` + 国内/国外模板
- 全局设置默认展开，字段名用**下划线**（`log_level`、`wan_interface` 等）

**★ DNS bootstrap 死锁（必读，wan_interface 代理本机的前提）**：
dae 默认把 DNS upstream 查询按 routing 走 `fallback: proxy`。但解析节点域名（如 hysteria2 的 `xxx.xyz`）要 DNS → DNS 走代理 → 用代理得先连节点（也是域名要 DNS）→ **死循环，所有节点 timeout**。
- 修复 = routing 加 `dip(<dns upstream ip>) -> direct` + DNS upstream 用 **IP 字面量**（域名 upstream 自己又要 bootstrap 解析，照样死锁）。
- 默认模板里 routing 的 dip 直连 IP 必须和 DNS upstream 的 IP 一致（都在 config.js 的 `_buildRoutingSection` / `_buildDNSSection` 里，改一个要同步另一个）。
- **国内路由器注意**：8.8.8.8 在墙内被污染，foreign DNS 直连会拿到错误 IP，需换成未污染的境外 DNS（DoH/DoT 等）。
- 诊断历史详见 `~/.claude/.../project_dae_router.md` 的"wan_interface=wan 真正根因"条。

---

## DaeConfig 数据形态（v2）

`dae-parser.js` 的 `parse()` 返回；`serialize()` 接收。所有 UI 改动都要在这个 shape 下闭环。

```javascript
{
  global:       { [key]: string },      // dae 字段名是下划线
  subscription: { [name]: url },
  node:         { [name]: uri },        // 手动节点
  groups: [                             // ★ v2 关键新增
    {
      name: 'proxy',
      filter: {
        subscriptions:   ['my_sub'],    // 选了哪些订阅
        nodes:           [],            // 选了哪些手动节点
        excludeKeywords: ['ExpireAt'],
        namePin:         null           // 非空时 = 手动选了某一个具体节点
      },
      policy: 'min_moving_avg'          // 'min_moving_avg' | 'random'
    }
  ],
  routing: { rules: [{condType,condValue,action}], fallback: 'proxy' },
  dns: { upstream: {}, domestic: '', foreign: '', rawRouting: '' },
  rawOther: ''  // 含无法解析的 group（rawGroups）和未知 top-level 块
}
```

---

## 几个 LuCI 的坑（踩过的）

| 坑 | 解决 |
|----|------|
| `'require baseclass'` 路由器上**没有** baseclass.js 文件 | LuCI 内置 `classes={baseclass:Class,...}`，require 时映射到内部 Class，**能用** |
| `L.require()` 返回**实例**（singleton），不是 class | 在 config.js 里**不要 `new`**：`self._parser = results[1]` 直接用 |
| `<ul class="cbi-tabmenu"><li class="cbi-tab">` 没 form.Map 时渲染成一行小字 | 用 `<button class="btn cbi-button cbi-button-action">` 才像按钮 |
| dae 字段名是**下划线**（`log_level`），不是 `log-level` | 表单字段 key 必须用下划线 |
| opkg 不让从 `26.146.x` 降到 `1.2`（feed 版本号是日期形式）| `PKG_VERSION:=2026.05.27` 这种 date-based 永远高过 |

---

## 开发工作流

### 1. 本地验证（无需路由器）

```bash
NODE=/Users/yufan/.cache/tailscale-node/bin/node    # macOS：用 Tailscale 自带的 node
cd luci-app-dae

# parser 单元测试（Node.js built-in assert，无外部依赖）
$NODE tests/parser.test.js          # 期望 Passed: 49

# 后端脚本测试（需要 jq）
sh tests/list-nodes.test.sh         # 期望 Passed: 5

# config.js 语法检查
$NODE --check htdocs/luci-static/resources/view/dae/config.js
```

### 2. GitHub Actions 编 .ipk

```bash
# 推到 main 自动触发
git push origin main

# 或手动触发
gh workflow run build.yml -R ysuolmai/luci-app-dae

# 等编完，下载产物
gh run download $(gh run list -R ysuolmai/luci-app-dae --limit 1 --json databaseId --jq '.[].databaseId') \
    -R ysuolmai/luci-app-dae -D /tmp/dae-artifacts
ls /tmp/dae-artifacts/luci-app-dae-ipk/
# luci-app-dae_<date>_all.ipk
# luci-i18n-dae-zh-cn_unknown_all.ipk
```

Workflow 用 ImmortalWrt 23.05.4 mediatek/filogic SDK 编 .ipk（架构无关，到处通用）。
不编 dae 二进制（dae 需要匹配目标 kernel 的 BTF，由主固件 CI 负责）。

### 3. 部署到测试路由器（172.28.1.224）

```bash
ROUTER=172.28.1.224
KEY=~/.ssh/claude_agent_ed25519     # 这把 key 已推到路由器，免密
scp -i $KEY /tmp/dae-artifacts/luci-app-dae-ipk/*.ipk root@$ROUTER:/tmp/

ssh -i $KEY root@$ROUTER 'cd /tmp && \
    opkg install --force-overwrite --force-reinstall \
        luci-app-dae_*.ipk luci-i18n-dae-zh-cn_*.ipk && \
    rm -f /tmp/luci-modulecache/* /tmp/luci-indexcache && \
    /etc/init.d/rpcd reload'
```

### 4. 快速迭代（不走 CI）

对于 JS 改动，可以直接 scp 单个文件免重编：

```bash
scp -i $KEY luci-app-dae/htdocs/luci-static/resources/view/dae/config.js \
            root@$ROUTER:/www/luci-static/resources/view/dae/
ssh -i $KEY root@$ROUTER 'rm -f /tmp/luci-modulecache/* /tmp/luci-indexcache'
```
浏览器 Cmd/Ctrl+Shift+R 强制刷新即可。

后端脚本（list-nodes.sh）改动同理 scp 到 `/usr/lib/luci-app-dae/`。

### 5. 在路由器上调试

```bash
# 看 dae 服务状态
ssh -i $KEY root@$ROUTER '/etc/init.d/dae status'
ssh -i $KEY root@$ROUTER 'logread | grep -i dae | tail -20'

# 验证 list-nodes.sh
ssh -i $KEY root@$ROUTER '/usr/lib/luci-app-dae/list-nodes.sh fetch test "https://你的订阅URL"'
ssh -i $KEY root@$ROUTER 'cat /tmp/dae-nodes-cache.json | jq .'

# 看 UCI config
ssh -i $KEY root@$ROUTER 'uci show dae'

# 启停 dae
ssh -i $KEY root@$ROUTER '/etc/init.d/dae enable; /etc/init.d/dae start'
```

---

## 路由器上的文件布局（部署后）

| 路径 | 内容 |
|------|------|
| `/etc/config/dae` | UCI 配置（enabled / config_file / log size）|
| `/etc/dae/config.dae` | dae 主配置（由 UI 写入）|
| `/etc/dae/example.dae` | dae 自带示例 |
| `/etc/init.d/dae` | procd 启动脚本 |
| `/usr/bin/dae` | dae 主程序（不在本仓库）|
| `/usr/lib/luci-app-dae/list-nodes.sh` | 我们的订阅解析脚本 |
| `/www/luci-static/resources/view/dae/*.js` | UI 文件 |
| `/usr/share/luci/menu.d/luci-app-dae.json` | LuCI 菜单 |
| `/usr/share/rpcd/acl.d/luci-app-dae.json` | ACL（含 list-nodes.sh 的 exec 权限）|
| `/tmp/dae-nodes-cache.json` | 节点 cache（list-nodes.sh refresh-all 生成）|

---

## 重要约定

- **Git commit co-author**：`Co-Authored-By: bugwriter <noreply@wahlau.top>`（不要用 Claude）
- **push 前 pull --rebase**：避免覆盖其他 session 的 commits
- **PKG_VERSION 用 date-based**：`2026.05.27` 这种，必须 > ImmortalWrt feed 的 `26.146.x`
- **TDD 节奏**：改 parser 先加测试 → 跑 fail → 实现 → 跑 pass → commit
- **不要在 LuCI 里用 `cbi-tabmenu`**：用 `cbi-button` + `cbi-button-action`

---

## 不支持 / 已知限制

| 限制 | 解决方法 |
|------|---------|
| Clash YAML / SIP008 订阅格式 | 用文本模式手动写 dae 配置 |
| dae 复杂 DNS routing 规则 | UI 保留 `rawRouting` 字段不动；高级用户文本模式编辑 |
| group 的 `tcp_check_url` / `udp_check_dns` 等 per-group 覆写 | parser 把这种 group 整个塞到 `rawOther` 里保留 |
| dae `policy: fixed(N)`（按索引选） | 不暴露在 UI，namePin 用 `filter: name(X) + policy: min_moving_avg` 等价实现 |
| 节点延迟测试 | dae 自己在跑，UI 不显示 |
| 配置文件历史 / 回滚 | 没做 |

---

## 项目演进概览（git 视角）

- v1（commits `d84733e..e4ecc8a` 在 OpenWRT-CI 仓库）：把 dae+luci-app-dae 包加进 OpenWRT-CI 主仓
- 拆分：commit `7d4bf03` 初始化独立仓库 `ysuolmai/luci-app-dae`
- v1 UI bug 修：`6a0db34` baseclass.extend、`bd16b38` L.require 不要 new
- v2：用户实测发现 v1 没有 group 概念，路由不可用
  - Spec: `docs/superpowers/specs/2026-05-27-dae-config-ui-design.md`（在 OpenWRT-CI 仓库）
  - Plan: `docs/superpowers/plans/2026-05-27-dae-config-ui-v2.md`（同上）
  - 15 个 task 完成：commits `e1e0252..0cd968d`
- v2 关键 commits：
  - `3a17b9f` parser `_parseGroup`
  - `50e1cdd` parser serialize groups
  - `2fc91ed` list-nodes.sh 后端
  - `42635b4` 3 tab 按钮样式
  - `d5e0204` 代理组 card 主 UI
  - `7d0a9d5` 所有节点 tab
  - `0cd968d` 字段名连字符 → 下划线（v1+v2 隐藏 bug）

---

## 相关链接

- 主固件 CI（包含 dae 内核选项 + diy.sh 拉取本仓库）：https://github.com/ysuolmai/OpenWRT-CI
- dae 上游：https://github.com/daeuniverse/dae
- dae 我们用的 fork（kdae 分支）：https://github.com/olicesx/dae/tree/kdae
- 测试路由器：172.28.1.224（root 密码 `showmeyourmoney`，但有 claude_agent_ed25519 公钥免密）
