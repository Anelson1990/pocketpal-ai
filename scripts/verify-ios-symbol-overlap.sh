#!/bin/bash
# Fails when two static archives both define a symbol, weak or strong, other
# than a third-party header instantiation (std::, JSI/React) or ThreadPool.
# Both archives link into one executable, where hidden visibility does not keep
# two definitions apart: the linker errors on strong pairs and silently picks
# one of a weak pair.
set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <a.a> <b.a>" >&2
  exit 64
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# One "<name>\t<binding>\t<nm line>" per defined symbol that is not
# non-external. A binding this does not know is kept.
external_symbols() {
  nm -m -U "$1" >"$tmp/nm" || return 1
  awk '
    function strip_annotations(s,   start, span) {
      while ((start = index(s, "[")) > 0 && (span = index(substr(s, start), "]")) > 0) {
        s = substr(s, 1, start - 1) substr(s, start + span)
      }
      return s
    }
    /^[[:space:]]*$/ || /:$/ { next }
    {
      line = $0
      sub(/^[0-9a-fA-F]+ /, "", line)
      sub(/^\([^)]*\) /, "", line)
      name = $NF
      binding = strip_annotations(substr(line, 1, length(line) - length(name)))
      gsub(/[[:space:]]+/, " ", binding)
      sub(/^ /, "", binding)
      sub(/ $/, "", binding)
      if (binding ~ /^non-external/ || name in seen) next
      seen[name] = 1
      print name "\t" binding "\t" $0
    }
  ' "$tmp/nm"
}

for side in a b; do
  archive=$1
  shift
  if ! external_symbols "$archive" >"$tmp/$side"; then
    echo "FAIL nm could not read $archive" >&2
    exit 1
  fi
  if [ ! -s "$tmp/$side" ]; then
    echo "FAIL no external symbols in $archive" >&2
    exit 1
  fi
done

awk -F '\t' 'NR == FNR { bind[$1] = $2; raw[$1] = $3; next }
  $1 in bind { print $1 "\t" bind[$1] "\t" $2 "\t" raw[$1] "\t" $3 }' \
  "$tmp/a" "$tmp/b" >"$tmp/shared"

# Mach-O adds one leading underscore to every name; -n keeps c++filt from
# stripping a second one, which would leave C++ names mangled.
cut -f 1 "$tmp/shared" | sed 's/^_//' | c++filt -n >"$tmp/demangled" || {
  echo "FAIL c++filt could not demangle the shared names" >&2
  exit 1
}
if [ "$(wc -l <"$tmp/demangled")" -ne "$(wc -l <"$tmp/shared")" ]; then
  echo "FAIL c++filt returned a different number of names" >&2
  exit 1
fi

paste "$tmp/demangled" "$tmp/shared" | awk -F '\t' '
  function allowed(name,   base) {
    base = name
    if (index(base, "vtable for ") == 1) base = substr(base, 12)
    else if (index(base, "typeinfo name for ") == 1) base = substr(base, 19)
    else if (index(base, "typeinfo for ") == 1) base = substr(base, 14)
    else if (index(base, "guard variable for ") == 1) base = substr(base, 20)
    if (base == "ThreadPool" || index(base, "ThreadPool::") == 1) return 1
    if (tolower(base) ~ /ggml|whisper|llama|dl_/) return 0
    return base == "__clang_call_terminate" ||
      index(base, "std::") == 1 ||
      index(base, "facebook::jsi::") == 1 ||
      index(base, "facebook::react::") == 1
  }
  {
    verdict = allowed($1) ? "ALLOW" : "DENY"
    if (verdict == "DENY") denied++
    print verdict " " $3 " / " $4 " " $1
    print "  " $5
    print "  " $6
  }
  END {
    print NR " shared, " denied + 0 " denied"
    exit denied > 0
  }
'
