# PostgreSQL image for Neottia memory testing: stock Postgres plus the
# extensions the Postgres backend uses or feature-detects:
#   - pg_textsearch (Timescale BM25 full-text search; requires PG 17/18 and
#     shared_preload_libraries=pg_textsearch — set by docker-compose)
# Build arguments let CI pin the extension version.
#
# Build:  docker build -t neottia/postgres-memory:latest .
# Run:    docker compose up -d   (from this directory)

FROM postgres:17-alpine

ARG PG_TEXTSEARCH_VERSION=main

RUN apk add --no-cache \
      build-base \
      clang21 \
      llvm21 \
      ca-certificates \
      git \
      postgresql17-dev

# pg_textsearch builds with PGXS against the image's own Postgres install.
RUN git clone --depth 1 --branch "${PG_TEXTSEARCH_VERSION}" \
      https://github.com/timescale/pg_textsearch /tmp/pg_textsearch \
 && cd /tmp/pg_textsearch \
 && make USE_PGXS=1 \
 && make USE_PGXS=1 install \
 && cd / \
 && rm -rf /tmp/pg_textsearch

# Extensions are enabled per database by the backend:
#   CREATE EXTENSION IF NOT EXISTS pg_textsearch;
# (shared_preload_libraries is injected by docker-compose command args)
