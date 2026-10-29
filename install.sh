#!/bin/sh
# fa installer for Linux / macOS:
#   curl -fsSL https://raw.githubusercontent.com/gl1ch5/fast-agent/main/install.sh | sh
#   another branch / tag: curl -fsSL .../<branch>/install.sh | FA_REF=<branch> sh
set -e

REF="${FA_REF:-main}"
REPO="https://raw.githubusercontent.com/gl1ch5/fast-agent/$REF"
DIR="${FA_BIN:-$HOME/.fa/bin}"

# ─── look ────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  E=$(printf '\033'); R="$E[0m"; B="$E[1m"; D="$E[2m"; G="$E[90m"
  OK="$E[32m"; WARN="$E[33m"; ERR="$E[31m"; AC="$E[38;5;141m"; AC2="$E[38;5;45m"; FANCY=1
else
  E=''; R=''; B=''; D=''; G=''; OK=''; WARN=''; ERR=''; AC=''; AC2=''; FANCY=''
fi

logo() {
  i=0
  for l in '███████╗ █████╗ ' '██╔════╝██╔══██╗' '█████╗  ███████║' '██╔══╝  ██╔══██║' '██║     ██║  ██║' '╚═╝     ╚═╝  ╚═╝'; do
    set -- 141 135 99 69 75 45; shift $i
    if [ -n "$FANCY" ]; then printf '  %s[38;5;%sm%s%s\n' "$E" "$1" "$l" "$R"; sleep 0.04; else printf '  %s\n' "$l"; fi
    i=$((i + 1))
  done
  printf '  %sfast agent%s %s· installer%s\n\n' "$B" "$R" "$G" "$R"
}

row() { printf '  %s %-10s %s\n' "$1" "$2" "$3"; }     # icon, label, value
done_() { row "${OK}✓${R}" "$1" "$2"; }
warn_() { row "${WARN}!${R}" "$1" "$2"; }
fail() { row "${ERR}✗${R}" "$1" "$2"; exit 1; }

# run a command in the background with a spinner on the current row
spin() {
  label="$1"; shift
  if [ -z "$FANCY" ]; then "$@"; return; fi
  "$@" &
  pid=$!
  set -- '⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏'
  n=0
  while kill -0 "$pid" 2>/dev/null; do
    n=$((n % 10 + 1)); eval "f=\${$n}"
    printf '\r  %s%s%s %s' "$AC" "$f" "$R" "$label"
    sleep 0.08
  done
  printf '\r%s[2K' "$E"
  wait "$pid"
}

dl() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL -H 'Cache-Control: no-cache' "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else return 127; fi
}
ver_of() { sed -n "s/^const VERSION = '\([^']*\)'.*/\1/p" "$1" 2>/dev/null | head -n 1; }
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null
}
newer() {   # is $1 newer than $2?
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$1" ]
}
home() { case "$1" in "$HOME"*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac; }

# ─── install ─────────────────────────────────────────────────────────────────
logo

mkdir -p "$DIR"
OLD="$(ver_of "$DIR/fa.ts")"
[ -n "$OLD" ] && row "${G}●${R}" "installed" "fa $OLD"

TMP="$DIR/fa.ts.tmp"
spin "downloading fa ${D}($REF)${R}" dl "$REPO/fa.ts?t=$(date +%s)" "$TMP" || { rm -f "$TMP"; fail "download" "failed — check your connection (needs curl or wget)"; }
NEW="$(ver_of "$TMP")"
[ -n "$NEW" ] || { rm -f "$TMP"; fail "download" "the file does not look like fa"; }
SIZE="$(wc -c < "$TMP" | tr -d ' ')"
mv "$TMP" "$DIR/fa.ts"
done_ "download" "fa $NEW ${G}· $((SIZE / 1024)) KB · $REF${R}"

cat > "$DIR/fa" <<EOF
#!/bin/sh
exec node "$DIR/fa.ts" "\$@"
EOF
chmod +x "$DIR/fa"
done_ "launcher" "$(home "$DIR/fa")"

if node_ok; then
  done_ "node" "$(node -v)"
elif command -v brew >/dev/null 2>&1; then
  spin "installing Node.js via Homebrew" sh -c 'brew install node >/dev/null 2>&1' || true
  if node_ok; then done_ "node" "$(node -v) ${G}(installed)${R}"; else warn_ "node" "brew install node failed — get Node.js 22.18+ from https://nodejs.org"; fi
else
  warn_ "node" "needs Node.js 22.18+ ${G}→ https://nodejs.org or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts${R}"
fi

NEWTERM=''
case ":$PATH:" in
  *":$DIR:"*) done_ "PATH" "${G}already set${R}" ;;
  *)
    LINE="export PATH=\"$DIR:\$PATH\""
    ADDED=""
    grep -qs "$DIR" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" && ADDED=" -"
    [ -z "$ADDED" ] && for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
      if [ -f "$rc" ] && ! grep -qs "$DIR" "$rc"; then echo "$LINE" >> "$rc"; ADDED="$ADDED $(home "$rc")"; fi
    done
    if [ -z "$ADDED" ]; then echo "$LINE" >> "$HOME/.profile"; ADDED=" ~/.profile"; fi
    if [ "$ADDED" != " -" ]; then done_ "PATH" "added in$ADDED"; else done_ "PATH" "${G}already in your shell profile${R}"; fi
    NEWTERM=1
    ;;
esac

# ─── summary ─────────────────────────────────────────────────────────────────
if [ -z "$OLD" ]; then TITLE="fa $NEW installed"
elif [ "$OLD" = "$NEW" ]; then TITLE="fa $NEW reinstalled (already latest)"
elif newer "$NEW" "$OLD"; then TITLE="fa updated $OLD -> $NEW"
else TITLE="fa $OLD -> $NEW"
fi
NEXT="run: fa"
[ -n "$NEWTERM" ] && NEXT="open a new terminal, then run: fa"

W=44
line=$(printf '%*s' "$W" '' | sed 's/ /─/g')
printf '\n  %s╭%s╮%s\n' "$AC" "$line" "$R"
printf '  %s│%s %s%-*s%s %s│%s\n' "$AC" "$R" "$B" $((W - 2)) "$TITLE" "$R" "$AC" "$R"
printf '  %s│%s %s%-*s%s %s│%s\n' "$AC" "$R" "$AC2" $((W - 2)) "$NEXT" "$R" "$AC" "$R"
printf '  %s╰%s╯%s\n\n' "$AC" "$line" "$R"
