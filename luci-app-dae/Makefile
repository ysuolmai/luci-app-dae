# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2024 ImmortalWrt.org

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-dae
# Use date-based version so opkg always accepts upgrade over upstream feed
# (which uses date-based versioning starting with e.g. 26.146.x).
# Bump this string when releasing.
PKG_VERSION:=2026.05.27
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Tianling Shen <cnsztl@immortalwrt.org>

LUCI_TITLE:=LuCI app for dae
LUCI_DEPENDS:=+dae
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
endef


include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
