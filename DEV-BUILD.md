# oxCloud Development Builds

Brief build/run reference for this workspace. Run commands from the project directory.

## oxCloudDash (`oxview-nav-fork/oxCloudDash`)

- On a development/non-production machine, build with `pnpm build` (this is still a static production export; do not use `pnpm dev` for this workflow).
- Production output is **`oxview-nav-fork/dist/dash/`** (configured by `next.config.ts`), not `oxCloudDash/dist/`.
- **Required:** set the `NEXT_PUBLIC_*` API variables before every build. Next.js bakes them into the static JavaScript at build time; changing environment variables after building has no effect.
- Local/non-production build:

```bash
NEXT_PUBLIC_API_AUTH_BASE_URL=http://localhost:3002/api/v1 \
NEXT_PUBLIC_API_AUTH_BASE_URL_PUBLIC=http://localhost:3002/api/v1 \
NEXT_PUBLIC_API_BASE_URL=http://localhost:8881 \
NEXT_PUBLIC_API_BASE_URL_PUBLIC=http://localhost:8881 \
pnpm build
```

Auth uses unitedcore TS (`:3002`); jobs/compute use the C++ backend (`:8881`). Hard-refresh after rebuilding. For another environment, replace these values before running `pnpm build`.

## unitedcore (TypeScript backend)

- On a development/non-production machine, compile with `pnpm build` → `dist/`.
- Run compiled backend: `pnpm start`.
- Prisma client/schema changes: `pnpm prisma:generate`; this workspace commonly uses `npx prisma db push` for local DB updates.

## oxView (`oxview-nav-fork`)

- Compile TypeScript once: `npx tsc` (writes compiled files to `dist/ts/`).
- Watch/reload: `pnpm load` (`tsc -w` plus reload helper).
- Serve SPA/dashboard: `pnpm serve-spa` (normally port 9002).
- The dashboard must be built separately from `oxCloudDash`; its export is served from `dist/dash/`.

## unitedcore/compute (C++ backend)

- API runs on port 8881 and launches sibling Docker job containers through `/var/run/docker.sock`.
- Normal CMake build (inside a build-capable environment):

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS=-std=c++17
cmake --build build -j4
```

- Quick rebuild of the running manual Docker deployment (avoids rebuilding the large GPU image). Replace the container name as needed:

```bash
docker cp src/controller.cpp oxcloud-compute-manual:/root/Github/compute/src/controller.cpp
# For changes in other files, copy those files/directories similarly.
docker exec oxcloud-compute-manual sh -c \
  'cd /root/Github/compute && find build/CMakeFiles -name "<changed-file>.cpp.o" -delete && cmake --build build -j$(nproc)'
docker restart oxcloud-compute-manual
```

For a full image/source rebuild use `docker compose build compute` followed by recreating the service; it is much slower on GPU builds. The quick build uses the persistent `/tmp/oxcloud-manual-compute` build mount.

## nanobase (`nanobase_rewrite_v1`)

- On a development/non-production machine, build with `pnpm build` (`next build`).
- Run compiled app: `pnpm start`.

## Local service ports

- unitedcore TS: `3002`
- C++ compute: `8881`
- oxView/oxCloudDash SPA: `9002`
- nanobase dev: `3000`
