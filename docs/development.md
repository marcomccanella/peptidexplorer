# Development and deployment

Install Node.js 22.12 or newer. The checked-in npm lockfile is the dependency source of truth.

```sh
npm ci
npm start
```

The development server listens on `127.0.0.1:8080` and stops if the port is already occupied. `npm run dev` runs the same server. Routes, browser code and server functions all run through TanStack Start.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Unit tests use Node's test runner and mocked external responses. They verify validation and pipeline behavior without depending on live database availability.

For browser checks, install Chromium once and run:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser tests exercise the interface and downloads. Live checks require internet access and available upstream databases:

```sh
npm run test:live
```

See [architecture](architecture.md) for the test/source folder map. Temporary browser artifacts are ignored by Git.

The latest recorded validation and upstream service limitations are in [testing notes](testing.md).

## Production on the same computer

```sh
npm run build
npm run start:production
```

The build emits a standalone Node.js server in `.output/`. The production script defaults to `127.0.0.1:8080`; `HOST` and `PORT` can override those defaults. Production includes the server functions that contact scientific databases. A static-only host is insufficient.

## Docker

Docker is optional. From the project folder:

```sh
docker build -t bacterial-beacon .
docker run --rm -p 127.0.0.1:8080:8080 bacterial-beacon
```

Open `http://localhost:8080`. The container listens on its own network interface, while the published port above is limited to your computer. The image builds the app first and runs the production server as the non-root `node` user.

## Intentional network access

For a temporary development session on a trusted network:

```sh
npm start -- --host 0.0.0.0
```

Open `http://<server-computer-IP>:8080` from another device. `localhost` on that device would refer to the device itself. Your firewall must allow the port.

For a shared service, build and run the production Node server with `HOST=0.0.0.0` and your chosen `PORT`, behind your normal HTTPS reverse proxy and access controls. Browser calls go to that server, and database requests leave from that server's network. There is no built-in user login; do not expose an unrestricted development server publicly.

## Database connectivity

All external lookups run in server functions. Credentials and browser-visible environment variables are unnecessary for the current public endpoints. BacDive uses its public v2 API.

Outbound requests have a 20-second timeout by default. Protein-details and classification requests retry temporary HTTP errors or network failures for up to three attempts; delay honors `Retry-After` up to 60 seconds. Peptide submission/polling reports busy or running states to the browser workflow, which handles bounded retries there. Empty successful responses, incomplete results and failed requests remain distinct. UniProt peptide-job completion is controlled by UniProt; live tests provide a point-in-time check, not an availability guarantee.

Reference setup: [TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting), [Nitro Vite integration](https://nitro.build/docs/vite).
