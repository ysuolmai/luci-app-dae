#!/bin/sh
# luci-app-dae node list extractor
#
# Usage:
#   list-nodes.sh fetch <sub_name> <url>     - wget URL, parse, return JSON array
#   list-nodes.sh from-file <path>           - parse a local file (for tests)
#   list-nodes.sh refresh-all                - fetch all subs from /etc/dae/config.dae, update cache
#
# Output: JSON array of {name, protocol, server, port} on stdout.
# For refresh-all, also writes /tmp/dae-nodes-cache.json with the merged result.
#
# Supported URI schemes: ss, vmess, vless, trojan, hysteria2, tuic
# Limitations: Clash YAML / SIP008 not supported.

CACHE=/tmp/dae-nodes-cache.json

# Portable base64 decode:
#   - Linux/busybox coreutils-base64: base64 -d
#   - macOS / BSD: base64 -D
#   - busybox WITHOUT base64 applet (ImmortalWrt default!): openssl base64 -d -A
# Probe order picks whichever exists; openssl is the most-likely-installed fallback
# on minimal OpenWrt builds where the base64 applet is not compiled in.
b64dec() {
    if command -v base64 >/dev/null 2>&1; then
        if base64 -d </dev/null >/dev/null 2>&1; then
            base64 -d 2>/dev/null
            return
        fi
        if base64 -D </dev/null >/dev/null 2>&1; then
            base64 -D 2>/dev/null
            return
        fi
    fi
    if command -v openssl >/dev/null 2>&1; then
        openssl base64 -d -A 2>/dev/null
        return
    fi
    # No decoder available — emit nothing, caller treats subscription as plain text
    return 1
}

# URL-decode %XX sequences using sed + shell
# Handles common percent-encoded characters; busybox-safe
urldec() {
    # We use printf + sed for portability; handles the most common cases
    sed 's/%20/ /g
         s/%21/!/g
         s/%23/#/g
         s/%24/$/g
         s/%25/%/g
         s/%26/\&/g
         s/%27/'"'"'/g
         s/%28/(/g
         s/%29/)/g
         s/%2[Aa]/*/g
         s/%2[Bb]/+/g
         s/%2[Cc]/,/g
         s/%2[Dd]/-/g
         s/%2[Ee]/./g
         s/%2[Ff]/\//g
         s/%3[Aa]/:/g
         s/%3[Bb]/;/g
         s/%3[Dd]/=/g
         s/%3[Ff]/?/g
         s/%40/@/g
         s/%5[Bb]/[/g
         s/%5[Dd]/]/g
         s/%5[Ff]/_/g
         s/%7[Ee]/~/g
         s/+/ /g'
}

# Pad base64 string to multiple of 4 characters
b64pad() {
    s="$1"
    rem=$((${#s} % 4))
    if [ "$rem" -ne 0 ]; then
        pad=$((4 - rem))
        while [ "$pad" -gt 0 ]; do s="${s}="; pad=$((pad - 1)); done
    fi
    printf '%s' "$s"
}

# --- URI parsers — each emits ONE JSON object on stdout ---

# ss://base64(method:pass)@host:port#name   OR   ss://base64(method:pass@host:port)#name
parse_ss() {
    body=$(printf '%s' "$1" | sed 's|^ss://||')
    name=$(printf '%s' "$body" | sed -n 's|.*#\(.*\)$|\1|p')
    [ -z "$name" ] && name="unnamed"
    name=$(printf '%s' "$name" | urldec)
    body_no_frag=$(printf '%s' "$body" | sed 's|#.*||')
    # try "userinfo@host:port" form first (modern SIP002)
    after_at=$(printf '%s' "$body_no_frag" | sed -n 's|.*@\(.*\)$|\1|p')
    if [ -n "$after_at" ]; then
        host=$(printf '%s' "$after_at" | sed 's|:.*||')
        port=$(printf '%s' "$after_at" | sed 's|.*:||' | sed 's|[^0-9].*||')
    else
        # legacy form: full base64 of method:pass@host:port
        padded=$(b64pad "$body_no_frag")
        decoded=$(printf '%s' "$padded" | b64dec)
        host=$(printf '%s' "$decoded" | sed -n 's|.*@\([^:]*\):.*|\1|p')
        port=$(printf '%s' "$decoded" | sed -n 's|.*@[^:]*:\([0-9]*\).*|\1|p')
    fi
    printf '{"name":"%s","protocol":"ss","server":"%s","port":%s}\n' \
        "$name" "$host" "${port:-0}"
}

# vmess://base64(json)
parse_vmess() {
    b64=$(printf '%s' "$1" | sed 's|^vmess://||')
    padded=$(b64pad "$b64")
    json=$(printf '%s' "$padded" | b64dec)
    if [ -z "$json" ]; then return 0; fi
    name=$(printf '%s' "$json" | sed -n 's|.*"ps"[[:space:]]*:[[:space:]]*"\([^"]*\)".*|\1|p')
    add=$(printf  '%s' "$json" | sed -n 's|.*"add"[[:space:]]*:[[:space:]]*"\([^"]*\)".*|\1|p')
    port=$(printf '%s' "$json" | sed -n 's|.*"port"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9]*\)"\{0,1\}.*|\1|p')
    printf '{"name":"%s","protocol":"vmess","server":"%s","port":%s}\n' \
        "${name:-unnamed}" "$add" "${port:-0}"
}

# scheme://creds@host:port?...#name  (generic for vless/trojan/hysteria2/tuic)
parse_generic() {
    scheme="$1"; line="$2"
    body=$(printf '%s' "$line" | sed "s|^${scheme}://||")
    name=$(printf '%s' "$body" | sed -n 's|.*#\(.*\)$|\1|p')
    [ -z "$name" ] && name="unnamed"
    name=$(printf '%s' "$name" | urldec)
    body=$(printf '%s' "$body" | sed 's|#.*||; s|?.*||')
    after_at=$(printf '%s' "$body" | sed -n 's|.*@\(.*\)$|\1|p')
    if [ -n "$after_at" ]; then
        host=$(printf '%s' "$after_at" | sed 's|:.*||')
        port=$(printf '%s' "$after_at" | sed 's|.*:||' | sed 's|[^0-9].*||')
    else
        host=$(printf '%s' "$body" | sed 's|:.*||')
        port=$(printf '%s' "$body" | sed 's|.*:||' | sed 's|[^0-9].*||')
    fi
    printf '{"name":"%s","protocol":"%s","server":"%s","port":%s}\n' \
        "$name" "$scheme" "$host" "${port:-0}"
}

parse_uri() {
    line="$1"
    scheme=$(printf '%s' "$line" | sed -n 's|^\([a-z0-9]*\)://.*|\1|p')
    case "$scheme" in
        ss)                          parse_ss "$line" ;;
        vmess)                       parse_vmess "$line" ;;
        vless|trojan|hysteria2|tuic) parse_generic "$scheme" "$line" ;;
        *)                           return 0 ;;
    esac
}

# Take raw subscription text, auto-detect base64 outer wrapper, parse all URIs,
# emit a JSON array on stdout.
parse_content() {
    raw="$1"
    # Try base64-decoding the whole thing; if result contains '://', it was wrapped
    decoded=$(printf '%s' "$raw" | b64dec 2>/dev/null) || decoded=""
    if printf '%s' "$decoded" | grep -q '://'; then
        text="$decoded"
    else
        text="$raw"
    fi

    # Collect parsed JSON objects, one per line
    objs=$(printf '%s\n' "$text" \
        | grep -E '^(ss|vmess|vless|trojan|hysteria2|tuic)://' \
        | while IFS= read -r line; do
            parse_uri "$line"
          done)

    if [ -z "$objs" ]; then
        printf '[]\n'
        return
    fi

    # Build JSON array
    printf '[\n'
    first=1
    printf '%s\n' "$objs" | while IFS= read -r obj; do
        [ -z "$obj" ] && continue
        if [ "$first" = "1" ]; then
            printf '  %s' "$obj"
            first=0
        else
            printf ',\n  %s' "$obj"
        fi
    done
    printf '\n]\n'
}

# --- command dispatch ---
cmd="$1"; shift
case "$cmd" in
    from-file)
        content=$(cat "$1")
        parse_content "$content"
        ;;
    fetch)
        sub_name="$1"; url="$2"
        content=$(wget -q -O - "$url" 2>/dev/null) || content=""
        if [ -z "$content" ]; then
            printf '[]\n'
            exit 1
        fi
        parse_content "$content"
        ;;
    refresh-all)
        # Strategy:
        #   1. If dae is running, scrape /var/log/dae/dae.log for the group-and-
        #      node-list block it prints at startup. dae has already fetched +
        #      validated the subscriptions, and trying to wget them ourselves
        #      while dae is running gets intercepted by dae's eBPF transparent
        #      proxy (EPERM or TLS errors). The dae log is the authoritative
        #      list of nodes-actually-in-use.
        #   2. If dae isn't running OR the log has no group block, fall back to
        #      wget+base64 mode per subscription (works when dae is stopped).
        #
        # Output schema is unchanged: { updated_at, subscriptions: { name: [
        #   {name, protocol, server, port}, ... ] } }
        # When sourced from the dae log we only know node names, so protocol/
        # server/port come out as empty strings.

        config=/etc/dae/config.dae
        logfile=/var/log/dae/dae.log

        # ----- Path 1: dae log scrape -----
        if [ -f "$logfile" ] && /etc/init.d/dae status 2>/dev/null | grep -q running; then
            # Extract { group_name → [node_names...] } from the latest startup block.
            # dae prints:
            #   level=info msg="Group \"X\" node list:"
            #   level=info msg="\t<nodename>"      (one per node, tab-prefixed)
            #   level=info msg="\t<Empty>"         (if no nodes)
            #   level=info ...                     (other lines end the list)
            #
            # We bucket nodes per group, then map each group to its filter's
            # subtag() target subscription (so the UI table shows source = sub
            # name, not group name).
            # dae log line is literally:
            #   level=info msg="<groupname>... node list:"      ← header
            #   level=info msg="<TAB><nodename>"                ← per node
            #   level=info <anything else>                      ← list ends
            # Use index()+substr() instead of regex because busybox awk does
            # not reliably interpret \t inside regex patterns.
            tmpgroups=$(mktemp)
            awk '
                {
                    # detect header: contains literal `node list:"`
                    if (index($0, "node list:\"") > 0) {
                        # group name is between the first `Group "` and `"`
                        s = $0
                        i = index(s, "Group \"")
                        if (i > 0) {
                            rest = substr(s, i + 7)
                            j = index(rest, "\"")
                            if (j > 0) {
                                cur_group = substr(rest, 1, j - 1)
                                in_list = 1
                                next
                            }
                        }
                    }
                    if (in_list) {
                        # A node line is specifically:  ...msg="<TAB><name>"
                        # Other info lines (Group selects dialer ...) also contain
                        # msg="..." but without a leading TAB, so we filter on that.
                        i = index($0, "msg=\"")
                        # char immediately after the opening quote is at position i+5
                        if (i > 0 && substr($0, i + 5, 1) == "\t") {
                            tail = substr($0, i + 6)
                            j = index(tail, "\"")
                            if (j > 0) {
                                name = substr(tail, 1, j - 1)
                                if (name != "<Empty>") print cur_group "\t" name
                                next
                            }
                        }
                        # any non-matching line ends the list block
                        in_list = 0
                    }
                }
            ' "$logfile" | sort -u > "$tmpgroups"

            # Build group → subscription mapping from config.dae
            # Match lines like:    filter: subtag(sub_a, sub_b)
            # NOTE: busybox awk does not accept '{' inside regex (treats it as
            # interval-quantifier opening), so we use field-position checks.
            tmpmap=$(mktemp)
            awk '
                $1 == "group" && $2 == "{" { in_group_block=1; next }
                in_group_block && NF == 2 && $2 == "{" { cur = $1; next }
                in_group_block && /filter:/ && /subtag\(/ {
                    s = $0
                    sub(/.*subtag\(/, "", s)
                    sub(/\).*/, "", s)
                    gsub(/[[:space:]]/, "", s)
                    if (cur != "") print cur "\t" s
                }
                /^}/ && in_group_block { in_group_block=0 }
            ' "$config" > "$tmpmap"

            # subscription list (so we emit entries even for subs with no nodes yet)
            sub_names=$(awk '/^subscription[[:space:]]*\{/,/^\}/' "$config" \
                | grep -E "^[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:" \
                | sed -E "s|^[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*:.*|\1|" \
                | sort -u)

            # Emit cache JSON: for each subscription, list the nodes belonging
            # to any group whose filter referenced that subscription.
            {
                printf '{"updated_at":%s,"subscriptions":{' "$(date +%s)"
                first_sub=1
                for sub in $sub_names; do
                    # find groups that subtag this sub
                    groups_for_sub=$(awk -F'\t' -v s="$sub" '
                        {
                            n = split($2, arr, ",")
                            for (i=1;i<=n;i++) if (arr[i]==s) { print $1; next }
                        }
                    ' "$tmpmap")
                    # collect unique node names across those groups
                    nodes_json=""
                    if [ -n "$groups_for_sub" ]; then
                        names=$(for g in $groups_for_sub; do
                            awk -F'\t' -v g="$g" '$1==g {print $2}' "$tmpgroups"
                        done | sort -u)
                        first_n=1
                        for n in $names; do
                            if [ "$first_n" = "1" ]; then
                                nodes_json='{"name":"'$n'","protocol":"","server":"","port":0}'
                                first_n=0
                            else
                                nodes_json="$nodes_json"',{"name":"'$n'","protocol":"","server":"","port":0}'
                            fi
                        done
                    fi
                    [ "$first_sub" = "1" ] || printf ','
                    printf '"%s":[%s]' "$sub" "$nodes_json"
                    first_sub=0
                done
                printf '}}\n'
            } > "$CACHE"
            rm -f "$tmpgroups" "$tmpmap"
            cat "$CACHE"
            exit 0
        fi

        # ----- Path 2: wget+base64 fallback (works when dae is stopped) -----
        if [ ! -f "$config" ]; then
            printf '{}' > "$CACHE"
            cat "$CACHE"
            exit 0
        fi
        subs=$(awk '/^subscription[[:space:]]*\{/,/^\}/' "$config" \
               | grep -E "^[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*:" \
               | sed -E "s|^[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*:[[:space:]]*['\"]?([^'\"]*)['\"]?[[:space:]]*$|\1\t\2|")
        out="{\"updated_at\":$(date +%s),\"subscriptions\":{"
        first=1
        printf '%s\n' "$subs" | while IFS="	" read -r name url; do
            [ -z "$name" ] && continue
            nodes=$("$0" fetch "$name" "$url")
            if [ "$first" = "1" ]; then
                out="${out}\"${name}\":${nodes}"
                first=0
            else
                out="${out},\"${name}\":${nodes}"
            fi
        done
        out="${out}}}"
        printf '%s\n' "$out" > "$CACHE"
        cat "$CACHE"
        ;;
    *)
        printf 'Usage: %s {fetch <name> <url> | from-file <path> | refresh-all}\n' "$0" >&2
        exit 1
        ;;
esac
