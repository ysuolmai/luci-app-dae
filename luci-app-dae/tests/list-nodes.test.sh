#!/bin/sh
# Run: sh tests/list-nodes.test.sh
# Requires: bash/sh, base64, jq, the script under test
set -e

SCRIPT="$(dirname "$0")/../root/usr/lib/luci-app-dae/list-nodes.sh"
FIXTURES="$(dirname "$0")/fixtures"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

pass=0
fail=0

run_test() {
    name="$1"; shift
    if "$@" >/dev/null 2>&1; then
        echo "  PASS: $name"
        pass=$((pass+1))
    else
        echo "  FAIL: $name"
        fail=$((fail+1))
    fi
}

echo "--- list-nodes.sh ---"

# Test 1: parse plain subscription file (no base64 outer layer)
run_test "from-file plain produces JSON array" sh -c "
    cp '$FIXTURES/sample-sub-plain.txt' '$TMPDIR/plain.txt'
    output=\$('$SCRIPT' from-file '$TMPDIR/plain.txt')
    [ -n \"\$output\" ] || exit 1
    echo \"\$output\" | jq -e 'type == \"array\"' >/dev/null
"

# Test 2: extracts ss node correctly
run_test "ss URI parsed: name=HK_01, protocol=ss, server=1.2.3.4, port=8388" sh -c "
    output=\$('$SCRIPT' from-file '$FIXTURES/sample-sub-plain.txt')
    ss=\$(echo \"\$output\" | jq '.[] | select(.protocol==\"ss\")')
    name=\$(echo \"\$ss\" | jq -r '.name')
    server=\$(echo \"\$ss\" | jq -r '.server')
    port=\$(echo \"\$ss\" | jq -r '.port')
    [ \"\$name\" = 'HK_01' ] && [ \"\$server\" = '1.2.3.4' ] && [ \"\$port\" = '8388' ]
"

# Test 3: extracts vmess (base64 JSON body) node name from 'ps' field
run_test "vmess URI parsed: name extracted from base64 JSON 'ps' field" sh -c "
    output=\$('$SCRIPT' from-file '$FIXTURES/sample-sub-plain.txt')
    vmess=\$(echo \"\$output\" | jq '.[] | select(.protocol==\"vmess\")')
    name=\$(echo \"\$vmess\" | jq -r '.name')
    [ \"\$name\" = 'US_01' ]
"

# Test 4: extracts trojan node name from URL fragment
run_test "trojan URI parsed: name from #fragment" sh -c "
    output=\$('$SCRIPT' from-file '$FIXTURES/sample-sub-plain.txt')
    trojan=\$(echo \"\$output\" | jq '.[] | select(.protocol==\"trojan\")')
    name=\$(echo \"\$trojan\" | jq -r '.name')
    [ \"\$name\" = 'JP_Trojan' ]
"

# Test 5: auto-detects base64-encoded outer wrapper
run_test "from-file with base64-outer produces same result as plain" sh -c "
    # macOS base64 doesn't have -w0; use tr to remove newlines.
    base64 < '$FIXTURES/sample-sub-plain.txt' | tr -d '\n' > '$TMPDIR/b64.txt'
    out_b64=\$('$SCRIPT' from-file '$TMPDIR/b64.txt' | jq -S .)
    out_plain=\$('$SCRIPT' from-file '$FIXTURES/sample-sub-plain.txt' | jq -S .)
    [ \"\$out_b64\" = \"\$out_plain\" ]
"

echo
echo "Passed: $pass  Failed: $fail"
[ "$fail" = "0" ]
