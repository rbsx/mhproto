# MHProto website

The homepage, documentation and interactive contract demo for mhproto.dev.

```sh
npm ci
npm run build:site
npm run dev:site
```

The build writes `website/dist/`. Documentation comes from the library's Markdown
guides. The demo uses the library viewer with a saved Impostor contract, baseline
and verification summaries. Its fixture omits local paths, captured runner logs
and executable check commands/environment.

The package remains a source preview. The site does not advertise an npm registry
installation or distribute the older unreviewed tarball.

Deploy with an authenticated Cloudflare Wrangler session:

```sh
npm run build:site
npx wrangler deploy
```

`wrangler.jsonc` publishes static assets to the MHProto Worker and attaches
`mhproto.dev` as its custom domain. This requires permission to deploy Workers and
manage routes for the active Cloudflare zone. GitHub repository visibility is
independent of deployment; npm publishing remains disabled with `private: true`.
