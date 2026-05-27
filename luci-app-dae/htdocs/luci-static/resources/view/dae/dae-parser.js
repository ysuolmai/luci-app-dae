// SPDX-License-Identifier: Apache-2.0
'use strict';
'require baseclass';

// dae DSL 解析 / 序列化（双环境：LuCI 浏览器 + Node.js 测试）
// LuCI: L.require() 要求 factory 返回构造函数 → 用 baseclass.extend()
// Node: tests 直接调 DaeParser._extractBlocks(...) → module.exports 是方法对象
var DaeParser = {

    /**
     * Extract top-level named blocks from dae config text.
     * Returns { blockName: contentString, ... }
     * Content strings do NOT include the outer braces.
     * Lines outside any block are stored in '__preamble'.
     * Duplicate block names are concatenated with '\n'.
     */
    _extractBlocks: function(text) {
        var blocks = {};
        var preamble = [];
        var currentBlock = null;
        var depth = 0;
        var bufferLines = [];

        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmed = line.trim();

            if (currentBlock === null) {
                // Match "blockname {" or "blockname{ rest..."
                var m = trimmed.match(/^([\w][\w-]*)\s*\{(.*)$/);
                if (m) {
                    currentBlock = m[1];
                    var afterBrace = m[2];
                    depth = 1;
                    for (var j = 0; j < afterBrace.length; j++) {
                        if (afterBrace[j] === '{') depth++;
                        else if (afterBrace[j] === '}') depth--;
                    }
                    if (depth <= 0) {
                        // Single-line block: "block { content }"
                        var inner = afterBrace.replace(/}[^}]*$/, '').trim();
                        blocks[currentBlock] = blocks[currentBlock] != null
                            ? blocks[currentBlock] + '\n' + inner : inner;
                        currentBlock = null;
                        depth = 0;
                    } else {
                        bufferLines = afterBrace.trim() ? [afterBrace] : [];
                    }
                } else {
                    preamble.push(line);
                }
            } else {
                // Count depth changes on this line
                for (var j = 0; j < trimmed.length; j++) {
                    if (trimmed[j] === '{') depth++;
                    else if (trimmed[j] === '}') depth--;
                }
                if (depth <= 0) {
                    // Closing brace found — strip it and everything after
                    var idx = line.lastIndexOf('}');
                    var beforeClose = line.substring(0, idx).trim();
                    if (beforeClose) bufferLines.push(beforeClose);
                    var content = bufferLines.join('\n');
                    blocks[currentBlock] = blocks[currentBlock] != null
                        ? blocks[currentBlock] + '\n' + content : content;
                    currentBlock = null;
                    depth = 0;
                    bufferLines = [];
                } else {
                    bufferLines.push(line);
                }
            }
        }

        var preambleStr = preamble.join('\n');
        if (preambleStr.trim().length > 0)
            blocks['__preamble'] = preambleStr;

        return blocks;
    },

    /**
     * Parse "name: value" lines.
     * Handles 'single-quoted', "double-quoted", and unquoted values.
     * Returns { name: value } with quotes stripped.
     * Skips # comments and blank lines.
     */
    _parseKV: function(content) {
        var result = {};
        var lines = content.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim();
            if (!trimmed || trimmed[0] === '#') continue;
            var m = trimmed.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
            if (!m) continue;
            var key = m[1];
            var val = m[2].trim();
            // Strip leading/trailing quote (same char)
            val = val.replace(/^(['"])(.*)\1$/, '$2');
            result[key] = val;
        }
        return result;
    },

    /**
     * Parse routing block content → { rules: [...], fallback: string }
     * Each rule: condType(condValue) -> action
     * Fallback: fallback: action
     */
    _parseRoutingRules: function(content) {
        var rules = [];
        var fallback = 'direct';
        var lines = content.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim();
            if (!trimmed || trimmed[0] === '#') continue;
            var fb = trimmed.match(/^fallback\s*:\s*(\S+)/);
            if (fb) { fallback = fb[1]; continue; }
            var rule = trimmed.match(/^([\w!][\w-]*)\(([^)]*)\)\s*->\s*(\S+)/);
            if (rule) {
                rules.push({ condType: rule[1], condValue: rule[2].trim(), action: rule[3] });
            }
        }
        return { rules: rules, fallback: fallback };
    },
    /**
     * Parse dns block content.
     * Returns { upstream: {name: url}, domestic, foreign, rawRouting }
     * Detects the simplified domestic/foreign template; stores custom
     * routing verbatim in rawRouting.
     */
    _parseDNS: function(content) {
        var self = this;
        var result = { upstream: {}, domestic: '', foreign: '', rawRouting: '' };
        var subBlocks = self._extractBlocks(content);

        if (subBlocks['upstream'])
            result.upstream = self._parseKV(subBlocks['upstream']);

        if (subBlocks['routing']) {
            var routingContent = subBlocks['routing'];
            var rb = self._extractBlocks(routingContent);
            var reqLines = (rb['request'] || '').split('\n')
                .map(function(l) { return l.trim(); }).filter(Boolean);
            var respLines = (rb['response'] || '').split('\n')
                .map(function(l) { return l.trim(); }).filter(Boolean);

            // Check simplified template:
            // request: qname(geosite:cn) -> <dom>, fallback: <for>
            // response: upstream(<for>) -> accept, !qname(geosite:cn) -> <for>, fallback: accept
            var isSimple = false, domestic = '', foreign = '';
            if (reqLines.length === 2) {
                var r1 = reqLines[0].match(/^qname\(geosite:cn\)\s*->\s*(\S+)/);
                var r2 = reqLines[1].match(/^fallback\s*:\s*(\S+)/);
                if (r1 && r2) {
                    domestic = r1[1]; foreign = r2[1];
                    if (respLines.length === 3) {
                        var s1 = respLines[0].match(/^upstream\((\S+)\)\s*->\s*accept/);
                        var s2 = respLines[1].match(/^!qname\(geosite:cn\)\s*->\s*(\S+)/);
                        var s3 = respLines[2].match(/^fallback\s*:\s*accept/);
                        if (s1 && s1[1] === foreign && s2 && s2[1] === foreign && s3)
                            isSimple = true;
                    }
                }
            }
            if (isSimple) { result.domestic = domestic; result.foreign = foreign; }
            else { result.rawRouting = routingContent; }
        }
        return result;
    },

    /**
     * If config.groups is empty, add a default group named `name`
     * (default 'proxy'), with all current subscription names selected and
     * 'ExpireAt' as the exclude keyword. Policy defaults to min_moving_avg.
     * Mutates config in place.
     */
    ensureDefaultGroup: function(config, name) {
        if (!config || !Array.isArray(config.groups)) return;
        if (config.groups.length > 0) return;
        name = name || 'proxy';
        config.groups.push({
            name: name,
            filter: {
                subscriptions: Object.keys(config.subscription || {}),
                nodes: [],
                excludeKeywords: ['ExpireAt'],
                namePin: null
            },
            policy: 'min_moving_avg'
        });
    },

    /**
     * Parse full dae config text → DaeConfig object.
     */
    parse: function(text) {
        var self = this;
        var blocks = self._extractBlocks(text);
        var config = {
            global: {}, subscription: {}, node: {},
            groups: [],                                                  // ← ADD THIS LINE
            routing: { rules: [], fallback: 'direct' },
            dns: { upstream: {}, domestic: '', foreign: '', rawRouting: '' },
            rawOther: ''
        };

        if (blocks['global'])       config.global       = self._parseKV(blocks['global']);
        if (blocks['subscription']) config.subscription = self._parseKV(blocks['subscription']);
        if (blocks['node'])         config.node         = self._parseKV(blocks['node']);
        if (blocks['routing'])      config.routing      = self._parseRoutingRules(blocks['routing']);
        if (blocks['dns'])          config.dns          = self._parseDNS(blocks['dns']);

        // Preserve unknown blocks verbatim
        var known = ['global', 'subscription', 'node', 'routing', 'dns', '__preamble'];
        var otherParts = blocks['__preamble'] ? [blocks['__preamble']] : [];
        for (var name in blocks) {
            if (known.indexOf(name) === -1)
                otherParts.push(name + ' {\n' + blocks[name] + '\n}');
        }
        config.rawOther = otherParts.join('\n\n');
        return config;
    },

    /**
     * Serialize DaeConfig → dae DSL string.
     * Order: global → subscription → node → dns → routing → rawOther
     */
    serialize: function(config) {
        var parts = [];
        var g = config.global || {}, gk = Object.keys(g);
        if (gk.length) {
            var ls = ['global {'];
            gk.forEach(function(k) { ls.push('    ' + k + ': ' + g[k]); });
            ls.push('}'); parts.push(ls.join('\n'));
        }

        var sk = Object.keys(config.subscription || {});
        if (sk.length) {
            var ls = ['subscription {'];
            sk.forEach(function(k) { ls.push("    " + k + ": '" + config.subscription[k] + "'"); });
            ls.push('}'); parts.push(ls.join('\n'));
        }

        var nk = Object.keys(config.node || {});
        if (nk.length) {
            var ls = ['node {'];
            nk.forEach(function(k) { ls.push("    " + k + ": '" + config.node[k] + "'"); });
            ls.push('}'); parts.push(ls.join('\n'));
        }

        var dns = config.dns || {};
        var uk = Object.keys(dns.upstream || {});
        if (uk.length || dns.domestic || dns.foreign || dns.rawRouting) {
            var ls = ['dns {'];
            if (uk.length) {
                ls.push('    upstream {');
                uk.forEach(function(k) { ls.push("        " + k + ": '" + dns.upstream[k] + "'"); });
                ls.push('    }');
            }
            if (dns.rawRouting) {
                ls.push('    routing {');
                dns.rawRouting.split('\n').forEach(function(l) { ls.push('    ' + l); });
                ls.push('    }');
            } else if (dns.domestic || dns.foreign) {
                var dom = dns.domestic || (uk[0] || '');
                var fgn = dns.foreign  || (uk[1] || '');
                ls.push('    routing {');
                ls.push('        request {');
                ls.push('            qname(geosite:cn) -> ' + dom);
                ls.push('            fallback: ' + fgn);
                ls.push('        }');
                ls.push('        response {');
                ls.push('            upstream(' + fgn + ') -> accept');
                ls.push('            !qname(geosite:cn) -> ' + fgn);
                ls.push('            fallback: accept');
                ls.push('        }');
                ls.push('    }');
            }
            ls.push('}'); parts.push(ls.join('\n'));
        }

        var routing = config.routing || {};
        var rules = routing.rules || [];
        var fb = routing.fallback || 'direct';
        {
            var ls = ['routing {'];
            rules.forEach(function(r) {
                ls.push('    ' + r.condType + '(' + r.condValue + ') -> ' + r.action);
            });
            ls.push('    fallback: ' + fb);
            ls.push('}'); parts.push(ls.join('\n'));
        }

        if (config.rawOther) parts.push(config.rawOther);
        return parts.join('\n\n');
    }
};

if (typeof module !== 'undefined') {
    module.exports = DaeParser;
    return;
}

// LuCI 环境：baseclass.extend 把方法挂到 prototype 上，返回类构造函数
// 调用方需要 new 一次拿到实例：var p = new DaeParserClass(); p.parse(text)
return baseclass.extend(DaeParser);
