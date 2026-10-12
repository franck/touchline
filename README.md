# Touchline

A local, interactive football coaching board built with React, TypeScript, SVG, and a live JSON HTTP API.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173. This starts both the browser app and the local board API. The connection status and active revision appear in the header.

After backend changes, stop and restart `npm run dev`, then refresh the page. Frontend hot reload does not reload API routes; an **Unknown API endpoint** error can mean the running server is outdated.

## Use

- **Move**: drag players or any ball independently.
- **Team size**: choose 5, 7, or 11 players per team (including the goalkeeper). Each size has appropriate formation choices, selected independently for home and away. Changing size sets both teams to their first formation, preserving all balls, drawings, equipment, and pitch choice. Size changes support Undo and are saved with sessions; older sessions default to five-a-side.
- **Small cones**: add round disc cones, then select one in Move mode to choose red, green, yellow, or blue. Each cone has its own saved color (red by default); color changes support Undo.
- **Neutral players**: click **Add neutral player** in Elements to add a yellow magnet at the centre. Neutrals have their own unique shirt numbers 1–11, independent of team size. Drag, delete, Undo, save, and export them like other players. Formation changes, team-size changes, and both reset operations preserve their positions; Clear board removes them.
- **Elements**: add home players, away players, balls, cones, small cones, and small goals at the centre, then drag them into place in Move mode. Players get the next free shirt number (up to the chosen team size). **Add ball** adds another ball each time, enabling one-ball-per-child activities; balls do not count toward team size. Select a player, ball, or equipment item to delete it individually. Equipment can be rotated in 45° steps; small cones have color controls instead. Small goals show their opening direction with a small arrow. Clear equipment removes all equipment, and Undo restores it.
- **Pitch layout**: choose U8 France (the default for new sessions) or Classic. U8 uses a 35 × 25 m playing area, 4 m-wide goals, and full-width protected-restart zones 8 m from each goal line. The preset is saved with the session; older sessions open as Classic. Switching layouts preserves relative tactical positions.
- **Rotate pitch**: switch between left-to-right and bottom-to-top views. Players and drawings rotate together, player numbers stay upright, and your preferred view is remembered in this browser.
- **Arrow / Line**: drag on the pitch to draw tactical instructions.
- **Dotted line**: drag to draw a line of round dots. Dotted lines support selection, deletion, Undo, and saved sessions in both pitch orientations.
- **Undo**: reverse the latest board change.
- In Move mode, click an element to select it, then click the bin to delete it. Without a selection, the bin clears all drawings.
- Choose a formation for either team, or click **Apply** to repopulate that full team using the currently selected formation. Team counts show how many players are currently present.
- **Reset positions** repositions only existing players and centres every existing ball; missing players and balls remain absent. Multiple centred balls overlap until moved apart.
- **Clear board**: the bottom button removes all players, all balls, equipment, and drawings, leaving only the pitch. Pitch settings and saved sessions are preserved; one Undo restores the prior board. The API also offers annotations-only clearing and full formation reset. API full reset centres all existing balls and adds one only if none exists.
- **Save session** stores the entire layout under a name on the local server. Select a saved session to reopen it in every connected board.
- **Export image**: choose PNG or SVG beside Save session. Downloads include the pitch and all committed elements in your current orientation, without selection highlights or controls. PNGs are 2,000 pixels on the longest edge; SVGs remain scalable.

The active board, shared Undo history, and saved sessions are persisted in `data/workspace.json`. Existing browser-local sessions are imported automatically when that browser connects; the original browser copy is retained. Display orientation remains a browser-local preference.

## Direct LLM control

An HTTP-capable LLM or coding agent can read and edit the live board at `http://127.0.0.1:5173/api/v1`:

- `GET /board`: current board and revision.
- `GET /board/export?format=png&orientation=horizontal`: download the current board as PNG or SVG; works without an open browser.
- `POST /board/export`: render a supplied board document as PNG or SVG without changing the live board, revision, Undo history, or saved sessions. Use this for document illustrations.
- `POST /board/operations`: add, update, delete elements, or configure the pitch/teams.
- `PUT /board`: replace a complete layout.
- `POST /board/undo`: undo the last API or manual edit.
- `POST /board/clear`: scopes `annotations`, `reset`, or `everything`. Empty/partial boards are supported by ordinary element add/delete operations.
- `GET /schema`: JSON Schemas and formation choices.
- `GET /events`: live updates.

See [API documentation and curl examples](docs/API.md) and [instructions for LLMs](docs/LLM-INSTRUCTIONS.md). Coordinates are normalized to 0–100; edits require the current revision and are validated atomically.

### Independent illustrations

Send a JSON body containing `board` (a complete public board document), optional `format` (`png` by default, or `svg`), and optional `orientation` (`horizontal` by default, or `vertical`) to `POST /api/v1/board/export`. No `expectedRevision` is needed. The response contains image bytes and an attachment filename; unlike current-board GET export, it has no `X-Board-Revision` header. The request schema is available as `export` in `GET /api/v1/schema`.

Even empty or sparse drill diagrams require valid pitch, team-size, and formation metadata. Players remain at the explicit positions supplied; rendering does not populate a formation. Multiple balls are supported within the overall 2,000-element limit. Save the board document beside the image to edit and regenerate it later; orientation belongs in the request or accompanying note, not the board document. See the [runnable JSON-file export example](docs/API.md#runnable-export-from-a-json-file).

## Build

```sh
npm run build
```

The production bundle is generated in `dist/`. Run `npm start` afterward to serve the app and API together. Node.js 22 or newer is recommended. Fonts use Google Fonts, with local sans-serif fallbacks.

## Verification

```sh
npm test
```

Tests cover coordinate conversion, formation invariants, atomic validation, HTTP edits, revision conflicts, live events, Undo, session migration, multiple-ball persistence, PNG/SVG rendering, and independent exports that preserve the complete workspace. Tests use isolated temporary workspaces.
