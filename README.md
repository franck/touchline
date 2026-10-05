# Touchline

A local, interactive football coaching board built with React, TypeScript, SVG, and a live JSON HTTP API.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173. This starts both the browser app and the local board API. The connection status and active revision appear in the header.

## Use

- **Move**: drag players or the ball.
- **Team size**: choose 5, 7, or 11 players per team (including the goalkeeper). Each size has appropriate formation choices, selected independently for home and away. Changing size sets both teams to their first formation, preserving the ball, drawings, equipment, and pitch choice. Size changes support Undo and are saved with sessions; older sessions default to five-a-side.
- **Small cones**: add round disc cones, then select one in Move mode to choose red, green, yellow, or blue. Each cone has its own saved color (red by default); color changes support Undo.
- **Elements**: add home players, away players, the ball, cones, small cones, and small goals at the centre, then drag them into place in Move mode. Players get the next free shirt number (up to the chosen team size); only one ball is allowed. Select a player, ball, or equipment item to delete it. Equipment can be rotated in 45° steps; small cones have color controls instead. Small goals show their opening direction with a small arrow. Clear equipment removes all equipment, and Undo restores it.
- **Pitch layout**: choose U8 France (the default for new sessions) or Classic. U8 uses a 35 × 25 m playing area, 4 m-wide goals, and full-width protected-restart zones 8 m from each goal line. The preset is saved with the session; older sessions open as Classic. Switching layouts preserves relative tactical positions.
- **Rotate pitch**: switch between left-to-right and bottom-to-top views. Players and drawings rotate together, player numbers stay upright, and your preferred view is remembered in this browser.
- **Arrow / Line**: drag on the pitch to draw tactical instructions.
- **Dotted line**: drag to draw a line of round dots. Dotted lines support selection, deletion, Undo, and saved sessions in both pitch orientations.
- **Undo**: reverse the latest board change.
- In Move mode, click an element to select it, then click the bin to delete it. Without a selection, the bin clears all drawings.
- Choose a formation for either team, or click **Apply** to repopulate that full team using the currently selected formation. Team counts show how many players are currently present.
- **Reset positions** repositions only the players and ball already present; missing players/ball remain absent.
- **Clear board**: the bottom button removes all players, the ball, equipment, and drawings, leaving only the pitch. Pitch settings and saved sessions are preserved; one Undo restores the prior board. The API also offers annotations-only clearing and full formation reset.
- **Save session** stores the entire layout under a name on the local server. Select a saved session to reopen it in every connected board.

The active board, shared Undo history, and saved sessions are persisted in `data/workspace.json`. Existing browser-local sessions are imported automatically when that browser connects; the original browser copy is retained. Display orientation remains a browser-local preference.

## Direct LLM control

An HTTP-capable LLM or coding agent can read and edit the live board at `http://127.0.0.1:5173/api/v1`:

- `GET /board`: current board and revision.
- `POST /board/operations`: add, update, delete elements, or configure the pitch/teams.
- `PUT /board`: replace a complete layout.
- `POST /board/undo`: undo the last API or manual edit.
- `POST /board/clear`: scopes `annotations`, `reset`, or `everything`. Empty/partial boards are supported by ordinary element add/delete operations.
- `GET /schema`: JSON Schemas and formation choices.
- `GET /events`: live updates.

See [API documentation and curl examples](docs/API.md) and [instructions for LLMs](docs/LLM-INSTRUCTIONS.md). Coordinates are normalized to 0–100; edits require the current revision and are validated atomically.

## Build

```sh
npm run build
```

The production bundle is generated in `dist/`. Run `npm start` afterward to serve the app and API together. Node.js 22 or newer is recommended. Fonts use Google Fonts, with local sans-serif fallbacks.

## Verification

```sh
npm test
```

Tests cover coordinate conversion, formation invariants, atomic validation, HTTP edits, revision conflicts, live events, Undo, session migration, and persistence across restarts. Tests use an isolated temporary workspace.
