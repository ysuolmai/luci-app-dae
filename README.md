# luci-app-dae

[dae](https://github.com/daeuniverse/dae)（基于 eBPF 的 Linux 内核级透明代理）的 LuCI Web UI 与 OpenWrt 打包脚本。

## 内容

```
.
├── dae/              # dae 主程序包（Makefile + UCI 配置 + init 脚本）
└── luci-app-dae/     # LuCI Web UI
    ├── htdocs/luci-static/resources/view/dae/
    │   ├── config.js       # 配置页（双 Tab：表单模式 / 文本模式）
    │   ├── dae-parser.js   # dae DSL 解析 / 序列化（纯前端 JS）
    │   ├── settings.js     # 服务设置页
    │   └── log.js          # 日志查看器
    ├── po/             # i18n（zh_Hans 已翻译）
    ├── root/etc/hotplug.d/iface/98-dae   # WAN 拨号触发 dae 重启
    └── root/usr/share/{luci,rpcd}/...    # 菜单 + ACL
```

## 特点

- **表单模式 + 文本模式双 Tab**：小白点点就能配置订阅 / 路由 / DNS，高手随时切回文本编辑器直接改 DSL
- **客户端纯 JS 解析**：不增加后端脚本，不影响固件体积，离线解析 dae 配置
- **保留未识别块**：用户在文本模式写的自定义内容（如复杂 DNS routing）原样保留，不会被表单覆盖

## 在 OpenWrt 构建中使用

### 方式 A：diy.sh 里 git clone（推荐）

```bash
# 在你的 OpenWrt CI 的 diy.sh 末尾
if [[ "$WRT_CONFIG" == *"DAE"* ]]; then
    git clone --depth=1 https://github.com/ysuolmai/luci-app-dae /tmp/luci-app-dae-feed
    cp -rf /tmp/luci-app-dae-feed/dae          package/
    cp -rf /tmp/luci-app-dae-feed/luci-app-dae package/
fi
```

### 方式 B：作为 OpenWrt feed

```
# 在 feeds.conf 里加一行
src-git custom_dae https://github.com/ysuolmai/luci-app-dae
```
然后 `./scripts/feeds update custom_dae && ./scripts/feeds install -a -p custom_dae`。

## 依赖（.config 里需要开启）

dae 需要 eBPF/BTF 等内核选项。参考 [ysuolmai/OpenWRT-CI](https://github.com/ysuolmai/OpenWRT-CI) 中 `Config/IPQ60XX-DAE-EMMC-WIFI-*.txt` 的完整配置，关键项：

```
CONFIG_KERNEL_DEBUG_INFO_BTF=y
CONFIG_KERNEL_CGROUP_BPF=y
CONFIG_KERNEL_BPF_EVENTS=y
CONFIG_KERNEL_XDP_SOCKETS=y
CONFIG_PACKAGE_dae=y
CONFIG_PACKAGE_luci-app-dae=y
CONFIG_PACKAGE_kmod-sched-core=y
CONFIG_PACKAGE_kmod-sched-bpf=y
```

## 开发

### Parser 单元测试

```bash
cd luci-app-dae
node tests/parser.test.js
```

无外部依赖，纯 Node.js 内置 `assert`。

### 来源

最初作为 [ysuolmai/OpenWRT-CI](https://github.com/ysuolmai/OpenWRT-CI) 仓库内的 `package/luci-app-dae/` 与 `package/dae/` 开发，2026-05-27 拆出为独立仓库。dae UI 设计文档（中文）参见原项目 `docs/superpowers/specs/2026-05-27-dae-config-ui-design.md`。

## License

dae 主程序 Apache-2.0（同 [daeuniverse/dae](https://github.com/daeuniverse/dae)）。  
LuCI UI 部分 Apache-2.0。
