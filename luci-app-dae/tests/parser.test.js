'use strict';
var assert = require('assert');
var DaeParser = require('../htdocs/luci-static/resources/view/dae/dae-parser.js');

var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('  PASS: ' + name); passed++; }
    catch (e) { console.log('  FAIL: ' + name + '\n    ' + e.message); failed++; }
}

// ---- _extractBlocks ----
console.log('\n_extractBlocks:');

test('parses a single block', function() {
    var r = DaeParser._extractBlocks('global {\n    key: val\n}');
    assert.ok(r['global'].trim().includes('key: val'));
});

test('parses multiple blocks', function() {
    var r = DaeParser._extractBlocks('global {\n    k: v\n}\nsubscription {\n    s: "url"\n}');
    assert.ok(r['global']);
    assert.ok(r['subscription']);
});

test('stores pre-block lines in __preamble', function() {
    var r = DaeParser._extractBlocks('# top comment\nglobal {\n    k: v\n}');
    assert.ok((r['__preamble'] || '').includes('# top comment'));
});

test('handles nested braces without splitting block', function() {
    var r = DaeParser._extractBlocks('dns {\n    upstream {\n        a: "b"\n    }\n}');
    assert.ok(r['dns'] && r['dns'].includes('upstream'));
    assert.strictEqual(r['upstream'], undefined);
});

test('handles block with content on same line as opening brace', function() {
    var r = DaeParser._extractBlocks('global { log-level: info\n}');
    assert.ok(r['global'].includes('log-level: info'));
});

test('returns empty object for empty input', function() {
    var r = DaeParser._extractBlocks('');
    assert.deepStrictEqual(r, {});
});

// ---- _parseKV ----
console.log('\n_parseKV:');

test('parses single-quoted value', function() {
    var r = DaeParser._parseKV("    my_sub: 'https://example.com'");
    assert.strictEqual(r['my_sub'], 'https://example.com');
});

test('parses double-quoted value', function() {
    var r = DaeParser._parseKV('    name: "https://example.com"');
    assert.strictEqual(r['name'], 'https://example.com');
});

test('parses unquoted value', function() {
    var r = DaeParser._parseKV('    log-level: info');
    assert.strictEqual(r['log-level'], 'info');
});

test('parses hyphenated key', function() {
    var r = DaeParser._parseKV('    lan-interface: br-lan');
    assert.strictEqual(r['lan-interface'], 'br-lan');
});

test('skips comment lines', function() {
    var r = DaeParser._parseKV('# comment\n    key: val');
    assert.strictEqual(Object.keys(r).length, 1);
    assert.strictEqual(r['key'], 'val');
});

test('skips empty lines', function() {
    var r = DaeParser._parseKV('\n\n    key: val\n\n');
    assert.strictEqual(Object.keys(r).length, 1);
});

test('returns empty object for empty content', function() {
    var r = DaeParser._parseKV('');
    assert.deepStrictEqual(r, {});
});

// ---- _parseRoutingRules ----
console.log('\n_parseRoutingRules:');

test('parses domain rule', function() {
    var r = DaeParser._parseRoutingRules('    domain(geosite:cn) -> direct');
    assert.strictEqual(r.rules.length, 1);
    assert.strictEqual(r.rules[0].condType, 'domain');
    assert.strictEqual(r.rules[0].condValue, 'geosite:cn');
    assert.strictEqual(r.rules[0].action, 'direct');
});

test('parses dip rule', function() {
    var r = DaeParser._parseRoutingRules('    dip(geoip:private) -> direct');
    assert.strictEqual(r.rules[0].condType, 'dip');
    assert.strictEqual(r.rules[0].condValue, 'geoip:private');
});

test('parses fallback line', function() {
    var r = DaeParser._parseRoutingRules('    fallback: my_proxy');
    assert.strictEqual(r.fallback, 'my_proxy');
});

test('parses multiple rules with fallback', function() {
    var content = '    domain(geosite:cn) -> direct\n    dip(geoip:cn) -> direct\n    fallback: proxy';
    var r = DaeParser._parseRoutingRules(content);
    assert.strictEqual(r.rules.length, 2);
    assert.strictEqual(r.fallback, 'proxy');
});

test('skips comment lines in routing', function() {
    var content = '    # a comment\n    domain(geosite:cn) -> direct\n    fallback: proxy';
    var r = DaeParser._parseRoutingRules(content);
    assert.strictEqual(r.rules.length, 1);
});

test('defaults fallback to direct when missing', function() {
    var r = DaeParser._parseRoutingRules('    domain(geosite:cn) -> direct');
    assert.strictEqual(r.fallback, 'direct');
});

// ---- _parseDNS ----
console.log('\n_parseDNS:');

var DNS_SIMPLE = [
    '    upstream {',
    "        alidns: 'udp://223.5.5.5:53'",
    "        googledns: 'tcp+udp://8.8.8.8:53'",
    '    }',
    '    routing {',
    '        request {',
    '            qname(geosite:cn) -> alidns',
    '            fallback: googledns',
    '        }',
    '        response {',
    '            upstream(googledns) -> accept',
    '            !qname(geosite:cn) -> googledns',
    '            fallback: accept',
    '        }',
    '    }'
].join('\n');

test('parses upstream servers', function() {
    var r = DaeParser._parseDNS(DNS_SIMPLE);
    assert.strictEqual(r.upstream['alidns'], 'udp://223.5.5.5:53');
    assert.strictEqual(r.upstream['googledns'], 'tcp+udp://8.8.8.8:53');
});

test('detects simplified domestic/foreign template', function() {
    var r = DaeParser._parseDNS(DNS_SIMPLE);
    assert.strictEqual(r.domestic, 'alidns');
    assert.strictEqual(r.foreign, 'googledns');
    assert.strictEqual(r.rawRouting, '');
});

test('stores non-template routing as rawRouting', function() {
    var custom = "    upstream {\n        alidns: 'udp://223.5.5.5:53'\n    }\n    routing {\n        request {\n            custom_rule(foo) -> bar\n        }\n    }";
    var r = DaeParser._parseDNS(custom);
    assert.ok(r.rawRouting.length > 0);
    assert.strictEqual(r.domestic, '');
    assert.strictEqual(r.foreign, '');
});

test('handles dns block with no routing sub-block', function() {
    var r = DaeParser._parseDNS("    upstream {\n        alidns: 'udp://223.5.5.5:53'\n    }");
    assert.strictEqual(r.upstream['alidns'], 'udp://223.5.5.5:53');
    assert.strictEqual(r.rawRouting, '');
});

// ---- parse() ----
console.log('\nparse():');

var FULL_CONFIG = [
    'global {',
    '    log-level: info',
    '    lan-interface: br-lan',
    '    wan-interface: eth1',
    '}',
    '',
    'subscription {',
    "    my_sub: 'https://example.com/sub'",
    '}',
    '',
    'dns {',
    '    upstream {',
    "        alidns: 'udp://223.5.5.5:53'",
    "        googledns: 'tcp+udp://8.8.8.8:53'",
    '    }',
    '    routing {',
    '        request {',
    '            qname(geosite:cn) -> alidns',
    '            fallback: googledns',
    '        }',
    '        response {',
    '            upstream(googledns) -> accept',
    '            !qname(geosite:cn) -> googledns',
    '            fallback: accept',
    '        }',
    '    }',
    '}',
    '',
    'routing {',
    '    domain(geosite:cn) -> direct',
    '    dip(geoip:cn) -> direct',
    '    dip(geoip:private) -> direct',
    '    fallback: my_sub',
    '}'
].join('\n');

test('parses global block', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    assert.strictEqual(c.global['log-level'], 'info');
    assert.strictEqual(c.global['lan-interface'], 'br-lan');
    assert.strictEqual(c.global['wan-interface'], 'eth1');
});

test('parses subscription block', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    assert.strictEqual(c.subscription['my_sub'], 'https://example.com/sub');
});

test('parses dns upstream and detects template', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    assert.strictEqual(c.dns.upstream['alidns'], 'udp://223.5.5.5:53');
    assert.strictEqual(c.dns.domestic, 'alidns');
    assert.strictEqual(c.dns.foreign, 'googledns');
    assert.strictEqual(c.dns.rawRouting, '');
});

test('parses routing rules', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    assert.strictEqual(c.routing.rules.length, 3);
    assert.strictEqual(c.routing.rules[0].condType, 'domain');
    assert.strictEqual(c.routing.fallback, 'my_sub');
});

test('stores unknown blocks in rawOther', function() {
    var withUnknown = FULL_CONFIG + '\n\nunknown_block {\n    x: y\n}';
    var c = DaeParser.parse(withUnknown);
    assert.ok(c.rawOther.includes('unknown_block'));
});

// ---- serialize() ----
console.log('\nserialize():');

test('serialize output is re-parseable (round-trip)', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    var s = DaeParser.serialize(c);
    var c2 = DaeParser.parse(s);
    assert.deepStrictEqual(c2.global, c.global);
    assert.deepStrictEqual(c2.subscription, c.subscription);
    assert.deepStrictEqual(c2.dns.upstream, c.dns.upstream);
    assert.strictEqual(c2.dns.domestic, c.dns.domestic);
    assert.strictEqual(c2.dns.foreign, c.dns.foreign);
    assert.deepStrictEqual(c2.routing.rules, c.routing.rules);
    assert.strictEqual(c2.routing.fallback, c.routing.fallback);
});

test('global block comes before subscription block', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    var s = DaeParser.serialize(c);
    assert.ok(s.indexOf('global {') < s.indexOf('subscription {'));
});

test('serialize preserves rawOther', function() {
    var withUnknown = FULL_CONFIG + '\n\nunknown_block {\n    x: y\n}';
    var c = DaeParser.parse(withUnknown);
    var s = DaeParser.serialize(c);
    assert.ok(s.includes('unknown_block'));
});

test('serialize generates simplified dns routing template', function() {
    var c = DaeParser.parse(FULL_CONFIG);
    var s = DaeParser.serialize(c);
    assert.ok(s.includes('qname(geosite:cn) -> alidns'));
    assert.ok(s.includes('upstream(googledns) -> accept'));
});

test('serialize skips empty blocks', function() {
    var c = DaeParser.parse('routing {\n    fallback: direct\n}');
    var s = DaeParser.serialize(c);
    assert.ok(!s.includes('subscription {'));
    assert.ok(!s.includes('node {'));
});

// ---- groups in DaeConfig ----
console.log('\ngroups field:');

test('parse() returns empty groups array when no group block', function() {
    var c = DaeParser.parse("subscription {\n  my_sub: 'https://x'\n}\nrouting {\n  fallback: direct\n}");
    assert.ok(Array.isArray(c.groups), 'groups should be an array');
    assert.strictEqual(c.groups.length, 0);
});

test('parse() returns empty groups array for empty input', function() {
    var c = DaeParser.parse('');
    assert.deepStrictEqual(c.groups, []);
});

// ---- ensureDefaultGroup ----
console.log('\nensureDefaultGroup:');

test('adds a default group when groups is empty', function() {
    var c = DaeParser.parse("subscription {\n  my_sub: 'https://x'\n}\nrouting {\n  fallback: proxy\n}");
    DaeParser.ensureDefaultGroup(c);
    assert.strictEqual(c.groups.length, 1);
    assert.strictEqual(c.groups[0].name, 'proxy');
    assert.deepStrictEqual(c.groups[0].filter.subscriptions, ['my_sub']);
    assert.deepStrictEqual(c.groups[0].filter.excludeKeywords, ['ExpireAt']);
    assert.strictEqual(c.groups[0].policy, 'min_moving_avg');
});

test('does nothing when groups already populated', function() {
    var c = {
        global: {}, subscription: {}, node: {}, groups: [{name: 'mygroup', filter: {subscriptions:[], nodes:[], excludeKeywords:[], namePin:null}, policy: 'random'}],
        routing: {rules:[], fallback:'direct'},
        dns: {upstream:{}, domestic:'', foreign:'', rawRouting:''},
        rawOther: ''
    };
    DaeParser.ensureDefaultGroup(c);
    assert.strictEqual(c.groups.length, 1);
    assert.strictEqual(c.groups[0].name, 'mygroup');
});

console.log('\n--- Results ---');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) process.exit(1);
