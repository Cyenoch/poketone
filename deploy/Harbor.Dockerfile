ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-alpine

WORKDIR /app
COPY deploy/.harbor/server.js ./server.js
USER bun
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:8787/health"); process.exit(r.ok ? 0 : 1)' || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "server.js"]
