# Open Prep Lab

Open Prep Lab is an open-source chess opening preparation workspace built around the "opening revolution" study workflow: instead of memorizing a static book, you study each position by combining what the big open databases say people actually play with what deep engine analysis says is objectively best.

It queries live open data:

- **Lichess Opening Explorer** (`explorer.lichess.ovh`) — the OTB masters database and the multi-billion-game Lichess community database, filterable by time control and rating band.
- **Lichess Cloud Eval** (`lichess.org/api/cloud-eval`) — community-contributed deep engine analysis (often depth 50–75) with multiple principal variations.

Imported PGNs and notes stay in the browser unless exported.

## Features

- Opening explorer with three sources: **Masters**, **Lichess** (with speed + rating filters), and **My PGN** (your own imported games, aggregated per position).
- Games count, share of total, white/draw/black bars, and score % for the side to move — per candidate move.
- **Deep Lines** panel with real cloud engine evaluation: depth, node count, and up to three principal variations rendered in SAN (click an eval to play the line's first move).
- Opening name + ECO code for the current position.
- Interactive board with legal move highlighting, candidate arrows for the top three database moves, and orientation toggle.
- Full line navigation: first/back/forward/last buttons, clickable move list, and ← / → keyboard shortcuts.
- PGN import that aggregates candidate move frequency and results; FEN import to jump to any position.
- Repertoire notes stored locally per position, and JSON export for studies.

## Lichess API token (optional)

The opening explorer occasionally requires authentication (it currently answers `401` for anonymous requests). If that happens, create a personal access token at <https://lichess.org/account/oauth/token/create> (no scopes needed) and paste it into the "Lichess API token" drawer in the Explorer panel. The token is stored only in your browser's localStorage. Cloud eval works without a token.

If the explorer is unreachable, the **My PGN** source still works fully offline against the bundled demo book plus anything you import.

## Development

```sh
npm install
npm run dev
```

## Verification

```sh
npm test
npm run build
```
