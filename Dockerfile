# LearnHarness — container packaging.
#
# Multi-stage: build the Next.js standalone server, fetch the pinned Chrome
# for Testing headless shell for demo verification, then assemble a slim
# runtime with the pinned Claude Code CLI. The container runs `node server.js`
# directly (not npm/npx) as the non-root `node` user.

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install app dependencies first so this layer survives source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Build everything:
#   plugins:setup  — npm ci each source plugin (core plugins need their deps)
#   npm run build  — plugins:build-core + plugins:build-authoring + next build
#   build-server   — curate .next/standalone (copies public/, .next/static/,
#                    the core-plugin payload and the runtime plugin loader the
#                    output-file tracer leaves out)
COPY . .
RUN npm run plugins:setup \
    && npm run build \
    && node scripts/build-server.mjs

# ── Stage 2: Chrome for Testing headless shell ──────────────────────────────
# Demos are verified in Chrome for Testing's headless shell (smaller than
# Debian's full Chromium). Pinned so a rebuild never changes the render
# engine; bump VERSION and SHA-256 together. amd64-only: Chrome for Testing
# publishes no linux-arm64 headless shell.
FROM node:22-bookworm-slim AS browser
ARG TARGETARCH
ARG CHROME_HEADLESS_SHELL_VERSION=156.0.8078.73
ARG CHROME_HEADLESS_SHELL_SHA256=77eb8d52798efc7a857ab61abcc62a456d8ea9635b02341d06dffee2761768c8
RUN test "${TARGETARCH:-amd64}" = amd64 || { echo "chrome-headless-shell has no linux-arm64 build; this image is amd64-only" >&2; exit 1; } \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_HEADLESS_SHELL_VERSION}/linux64/chrome-headless-shell-linux64.zip" -o /tmp/shell.zip \
    && echo "${CHROME_HEADLESS_SHELL_SHA256}  /tmp/shell.zip" | sha256sum -c - \
    && unzip -q /tmp/shell.zip -d /opt && rm /tmp/shell.zip

# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# The Claude Code provider runs the real `claude -p` CLI. Pinned so a rebuild
# never changes the binary behind the bridge; the self-updater stays off.
# Auth is CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`); the CLI writes
# its state to CLAUDE_CONFIG_DIR, a mounted writable directory.
ARG CLAUDE_CODE_VERSION=2.1.312
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# Runtime system libraries:
#   * fonts-dejavu-core + fontconfig-config — resvg/Skia need system fonts to
#     render figure/SVG/PDF text (without fontconfig, text renders blank).
#   * the headless shell's shared libraries (found with ldd).
#   * ca-certificates — TLS for demo CDN scripts and provider requests.
#   * python3 — the Coding Questions plugin runs the teacher-named test
#     program on PATH, and `python3 -` is the common case. Node is already
#     present in the base image. python3 adds ~50 MB; drop it if coding
#     questions are unused.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-dejavu-core fontconfig-config python3 \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libdbus-1-3 \
    libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 \
    libexpat1 libxcb1 libxkbcommon0 libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=browser /opt/chrome-headless-shell-linux64 /opt/chrome-headless-shell-linux64

# node server.js binds these; keep the port loopback-published at the host.
# The access gate (LH_WEB_ORIGIN / LH_WEB_ACCESS_TOKEN / LH_TAILSCALE_USERS)
# comes from secrets/runtime.env; provider keys, custom providers and the
# Claude Code opt-in from the read-only config file at LH_CONFIG_FILE.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/claude \
    CHROME_PATH=/opt/chrome-headless-shell-linux64/chrome-headless-shell \
    LH_DATA_DIR=/data \
    LH_CONFIG_FILE=/secrets/config/config.json

WORKDIR /app
# The standalone dir is self-contained: server.js + traced node_modules +
# public/ + .next/static/ + core-plugins/ + the traced prompt assets.
COPY --from=builder --chown=node:node /app/.next/standalone/ ./

RUN mkdir -p /data /secrets /claude && chown node:node /data /secrets /claude
EXPOSE 3000
USER node
CMD ["node", "server.js"]
