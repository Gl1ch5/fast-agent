#!/bin/sh
# fa installer for Linux / macOS:
#   curl -fsSL https://raw.githubusercontent.com/gl1ch5/fast-agent/main/install.sh | sh
#   another branch / tag: curl -fsSL .../<branch>/install.sh | FA_REF=<branch> sh
set -e

REF="${FA_REF:-main}"
REPO="https://raw.githubusercontent.com/gl1ch5/fast-agent/$REF"
DIR="${FA_BIN:-$HOME/.fa/bin}"

say() { printf '\033[36m>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }

dl() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL -H 'Cache-Control: no-cache' "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "curl or wget is required" >&2; exit 1; fi
}

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null
}

mkdir -p "$DIR"
say "downloading fa.ts ($REF) -> $DIR"
dl "$REPO/fa.ts?t=$(date +%s)" "$DIR/fa.ts.tmp"
mv "$DIR/fa.ts.tmp" "$DIR/fa.ts"

cat > "$DIR/fa" <<EOF
#!/bin/sh
exec node "$DIR/fa.ts" "\$@"
EOF
chmod +x "$DIR/fa"

if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    say "installing Node.js via Homebrew"
    brew install node
  else
    warn "fa needs Node.js 22.18 or newer: https://nodejs.org (or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts)"
  fi
fi

case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    LINE="export PATH=\"$DIR:\$PATH\""
    ADDED=""
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
      if [ -f "$rc" ] && ! grep -qs "$DIR" "$rc"; then echo "$LINE" >> "$rc"; ADDED="$ADDED $rc"; fi
    done
    if [ -z "$ADDED" ] && ! grep -qs "$DIR" "$HOME/.profile"; then echo "$LINE" >> "$HOME/.profile"; ADDED=" $HOME/.profile"; fi
    [ -n "$ADDED" ] && say "added $DIR to PATH in$ADDED"
    warn "open a new terminal (or run: export PATH=\"$DIR:\$PATH\")"
    ;;
esac

VER="$(node "$DIR/fa.ts" --version 2>/dev/null || true)"
say "done: fa $VER. run: fa"
