# Touchline JSON API v1

Base URL: `http://127.0.0.1:5173/api/v1`. The browser and API use the same local server. The API can edit the board even when no browser is open. Open `http://localhost:5173` to watch changes live.

## Read → edit → verify

1. `GET /schema` for machine-readable JSON Schemas, formations, and coordinate conventions.
2. `GET /board` for `{revision, board, canUndo}`.
3. Submit `POST /board/operations` or `PUT /board` with that `expectedRevision`.
4. On `409`, reread the board and rebuild your edits using its current IDs and revision. Never blindly resend stale edits.

Every successful board write increments the revision and adds one Undo entry (up to 50). Batches are atomic: any invalid operation leaves the board, revision, and history unchanged. Both mouse changes and API changes use this history. Session saving/deletion does not alter the board revision.

## Coordinates and angles

All positions and drawing endpoints use **0–100 coordinates inside the playing area**, excluding the pitch border.

- `x=0`: home goal line; `x=100`: away goal line. Home attacks toward increasing x.
- `y=0`: upper touchline in horizontal view; `y=100`: lower touchline.
- The centre is `{ "x": 50, "y": 50 }`.
- Display rotation changes neither coordinates nor equipment angles.
- Equipment `rotation` is degrees clockwise, `0 <= rotation < 360`. At zero, a small goal opens toward positive y; `90` opens toward negative x; `180` toward negative y; `270` toward positive x.
- On the 35 × 25 m U8 pitch, the protected lines are at x=22.857142857 and x=77.142857143. Zone depth is 8 m.

## Board document

```json
{
  "schemaVersion": 1,
  "pitch": "u8",
  "teamSize": 5,
  "formations": { "home": "1–2–1", "away": "2–2" },
  "elements": []
}
```

The example above is a valid empty board. Boards may contain **zero or more balls and zero to teamSize players in each home/away team**, plus neutral players as described below. Balls have independent IDs and positions; there is no separate ball quota within the 2,000-element limit. Home/away shirt numbers must be unique within their team and between 1 and teamSize; gaps are allowed. All element IDs must be unique across the entire board. Read IDs from the board rather than inferring them from shirt numbers.

Players also support `team: "neutral"`, displayed as yellow magnets. Up to 11 neutral players are allowed regardless of team size, with unique neutral shirt numbers 1–11. Their numbers may overlap home/away numbers. Neutrals have no formation and retain their IDs and positions through team-size changes, formation changes, and both API and browser resets. They support normal add/update/delete, Undo, sessions, and image exports, and are removed by `scope: "everything"`.

`pitch` is `u8` or `classic`. Sizes are `5`, `7`, or `11`, including the goalkeeper (shirt number 1 in presets). Formation strings use the en dash `–`:

| Size | Formations |
|---|---|
| 5 | `1–2–1`, `2–2`, `2–1–1` |
| 7 | `2–3–1`, `3–2–1`, `2–2–2`, `3–3` |
| 11 | `4–4–2`, `4–3–3`, `4–2–3–1`, `3–5–2`, `3–4–3` |

Formation metadata describes the chosen starting shape; players may subsequently move anywhere. `pitch`, `teamSize`, and both valid formation strings are required even for empty or sparse drill diagrams. Choose the smallest supported team size accommodating the number of players in each home/away team; for ten home players, use `teamSize: 11`. Balls and neutrals do not count toward team size. Replacing or independently exporting a board does not automatically arrange its players: its explicit positions are used. Use `configure` to apply formation presets to the live board.

### Element shapes

All listed fields are required. Unknown fields are rejected.

```json
[
  { "id": "home-0", "type": "player", "team": "home", "number": 1, "position": { "x": 6, "y": 50 } },
  { "id": "neutral-1", "type": "player", "team": "neutral", "number": 1, "position": { "x": 50, "y": 25 } },
  { "id": "ball", "type": "ball", "position": { "x": 50, "y": 50 } },
  { "id": "cone-a", "type": "cone", "position": { "x": 35, "y": 30 }, "rotation": 0 },
  { "id": "disc-a", "type": "small-cone", "position": { "x": 35, "y": 60 }, "rotation": 0, "color": "yellow" },
  { "id": "goal-a", "type": "goal", "position": { "x": 70, "y": 50 }, "rotation": 90 },
  { "id": "pass-a", "type": "drawing", "start": { "x": 30, "y": 30 }, "end": { "x": 60, "y": 60 }, "style": "dotted", "arrow": true }
]
```

Small-cone colours: `red`, `green`, `yellow`, `blue`. Drawings can combine `style: solid | dotted` with `arrow: true | false`. The browser preserves all these styles when loading or editing API-generated boards.

## Operation batches

`POST /board/operations`:

```json
{
  "expectedRevision": 12,
  "operations": [
    { "action": "configure", "pitch": "u8", "teamSize": 5, "formations": { "home": "1–2–1" } },
    { "action": "add", "element": { "id": "disc-left", "type": "small-cone", "position": { "x": 30, "y": 35 }, "rotation": 0, "color": "yellow" } },
    { "action": "update", "id": "home-2", "changes": { "position": { "x": 40, "y": 50 } } },
    { "action": "add", "element": { "id": "pass-left", "type": "drawing", "start": { "x": 30, "y": 35 }, "end": { "x": 40, "y": 50 }, "style": "dotted", "arrow": true } }
  ]
}
```

- **add**: provide a complete new element with a unique ID.
- **update**: provide an existing ID and applicable fields in `changes`. IDs, element type, and player team are immutable through update. `position`, `start`, and `end` are complete `{x,y}` objects. Fields not applicable to that element type are rejected.
- **delete**: `{ "action": "delete", "id": "disc-left" }`. Players and balls can be deleted individually without replacement, leaving a partial or empty setup. Ball updates and deletions affect only the specified ID.
- **configure**: optional `pitch`, `teamSize`, and/or `formations` (home and/or away). Size changes regenerate both teams; unspecified formations default to the first formation of the new size. Specifying a formation populates that full team, even from an empty board or when reapplying the same formation. Surviving players retain their IDs by shirt number, and new IDs avoid collisions with existing elements. All neutrals, balls, equipment, and drawings are preserved; no ball is added if none exists. Pitch-only changes preserve all element positions.

Operations are processed in order and final board invariants are checked at the end. Coordinates, types, and fields are validated on each operation. Maximum 2,000 elements or operations; maximum request body 2 MB.

## Full replacement and Undo

`PUT /board`: `{ "expectedRevision": 12, "board": <complete document> }`.

`POST /board/undo`: `{ "expectedRevision": 13 }`. Restores the prior board and advances the revision (revisions never decrease). API and browser edits share the same Undo stack, which survives server restarts.

## Clear the board

`POST /board/clear` cleans the active board as one undoable change:

```json
{ "expectedRevision": 12, "scope": "annotations" }
```

- `annotations`: remove all drawings, cones, small cones, and small goals. Keep all player and ball positions.
- `reset`: remove annotations, restore both full selected formations, preserve neutral players at their current positions, and centre **every existing ball**, preserving each ball's ID. Add one centred ball only if no balls exist. Centred balls overlap visually until moved apart.
- `everything`: remove every element, including all players and all balls, leaving only the pitch.

All scopes preserve pitch layout, team size, formation choices, and saved sessions. `annotations` and `reset` retain IDs of surviving players/ball. They require the current revision, update every connected browser live, and return `{revision,board,canUndo}`. Even clearing an already-clean board creates one undoable revision. Undo after `everything` restores all original elements and IDs.

To create an empty training board:

```json
{ "expectedRevision": 12, "scope": "everything" }
```

Rebuild it with normal `add` operations. For example, add one player without populating a full team:

```json
{
  "expectedRevision": 13,
  "operations": [
    { "action": "add", "element": { "id": "training-home-1", "type": "player", "team": "home", "number": 1, "position": { "x": 50, "y": 50 } } },
    { "action": "add", "element": { "id": "training-ball", "type": "ball", "position": { "x": 45, "y": 50 } } }
  ]
}
```

The browser's bottom **Clear board** button always uses `everything`, removing every element without a scope dropdown. The **Elements** panel adds home/away players with the next free shirt number; **Add ball** adds another independently movable ball at the centre each time. A formation's **Apply** button restores that full team and preserves all balls. **Reset positions** only moves players and balls already present; it does not repopulate the board or add missing balls. It centres all existing balls, so they overlap until moved apart. Empty, partial, and multiple-ball setups can be saved and reopened normally.

```sh
BASE=http://127.0.0.1:5173/api/v1
REV=$(curl -sS "$BASE/board" | jq '.revision')
jq -n --argjson revision "$REV" '{expectedRevision: $revision, scope: "annotations"}' |
  curl -sS -X POST "$BASE/board/clear" -H 'Content-Type: application/json' --data-binary @- | jq
```

## Image export

Both export endpoints work without an open browser. PNG images have a 2,000-pixel longest edge; SVG images use the same dimensions and can be scaled. Images include the complete pitch, players, all balls, equipment, and drawings, excluding UI, selection highlights, and unfinished gestures. Vertical images keep player numbers upright. Empty, partial, and multiple-ball boards are supported. Neither endpoint changes the live board or Undo history.

### Current-board export — GET

`GET /board/export` downloads the current persisted board without requiring an open browser.

| Query parameter | Values | Default |
|---|---|---|
| `format` | `png`, `svg` | `png` |
| `orientation` | `horizontal`, `vertical` | `horizontal` |
| `expectedRevision` | Optional nonnegative integer | Latest revision |

Responses use `image/png` or `image/svg+xml`, an attachment filename `touchline-board-r<revision>.<format>`, and `X-Board-Revision` identifying the exported revision. Export does not change the board or Undo history. Invalid query parameters return `422`; a mismatched `expectedRevision` returns the normal `409` snapshot. Browser orientation is local, so API callers must request vertical orientation explicitly.

```sh
curl --fail --show-error 'http://127.0.0.1:5173/api/v1/board/export' -o board.png
curl --fail --show-error 'http://127.0.0.1:5173/api/v1/board/export?format=svg&orientation=vertical' -o board.svg
```

### Independent document export — POST

**Use this endpoint to generate illustrations for notes, drills, or tactics without disturbing the live board.** `POST /board/export` accepts a complete public board document in its JSON body:

```json
{
  "board": {
    "schemaVersion": 1,
    "pitch": "u8",
    "teamSize": 5,
    "formations": { "home": "1–2–1", "away": "2–2" },
    "elements": [
      { "id": "child-a", "type": "player", "team": "home", "number": 1, "position": { "x": 30, "y": 30 } },
      { "id": "ball-a", "type": "ball", "position": { "x": 30, "y": 35 } },
      { "id": "child-b", "type": "player", "team": "home", "number": 2, "position": { "x": 65, "y": 60 } },
      { "id": "ball-b", "type": "ball", "position": { "x": 65, "y": 65 } }
    ]
  },
  "format": "png",
  "orientation": "horizontal"
}
```

| Body field | Values | Default |
|---|---|---|
| `board` | Complete public board document | Required |
| `format` | `png`, `svg` | `png` |
| `orientation` | `horizontal`, `vertical` | `horizontal` |

Options belong in the body, not the query string. No `expectedRevision` is needed or accepted. The supplied document is rendered independently of the current revision. All document rules apply, including valid formations, unique IDs, player numbering, coordinates, the 2,000-element limit, and the 2 MB request-body limit. Unknown body/document fields are rejected. `GET /schema` exposes the input schema as `export`; only `board` is required.

Successful responses are `200` with image bytes, `Content-Type: image/png` or `image/svg+xml`, `Content-Disposition: attachment; filename="touchline-board.png"` (or `.svg`), and `Cache-Control: no-store`. **There is no `X-Board-Revision` header**, because the image is not a live-board snapshot. Malformed JSON returns `400`; invalid documents or options return `422` with the standard JSON error response. No board, revision, Undo history, sessions, persisted workspace, or live events are changed, including on rejection.

To export a saved session independently, pass its `board` directly to this endpoint; loading it onto the live board is unnecessary. Retain the plain board document as `<diagram>.board.json` and record orientation separately in the note for later regeneration. Use only supported element shapes; explain role colours, arrows, and dimensions in a caption rather than adding unsupported labels to the document.

#### Runnable export from a JSON file

Requires `curl` and `jq`. Run from a directory where you want the generated files. Start Touchline first. This example creates a two-player/two-ball drill snapshot and renders it without editing the live board:

```sh
BASE=http://127.0.0.1:5173/api/v1
jq -n '{
  schemaVersion: 1, pitch: "u8", teamSize: 5,
  formations: {home: "1–2–1", away: "2–2"},
  elements: [
    {id: "child-a", type: "player", team: "home", number: 1, position: {x: 30, y: 30}},
    {id: "ball-a", type: "ball", position: {x: 30, y: 35}},
    {id: "child-b", type: "player", team: "home", number: 2, position: {x: 65, y: 60}},
    {id: "ball-b", type: "ball", position: {x: 65, y: 65}}
  ]
}' > drill.board.json

# Wrap the saved board in the export request. The original snapshot stays reusable.
jq '{board: ., format: "png", orientation: "horizontal"}' drill.board.json > drill.export.json
curl --fail --show-error "$BASE/board/export" \
  -H 'Content-Type: application/json' --data-binary @drill.export.json \
  -o drill.png

# Render the same saved document vertically as SVG.
jq '{board: ., format: "svg", orientation: "vertical"}' drill.board.json > drill.export.json
curl --fail --show-error "$BASE/board/export" \
  -H 'Content-Type: application/json' --data-binary @drill.export.json \
  -o drill.svg
```

Check the HTTP result and image before embedding it in a note. When replacing an existing illustration, export to a temporary filename and publish it only after success, keeping the previous image if export fails.

## Live events

`GET /events` is a server-sent event stream. It immediately sends the current snapshot, then broadcasts snapshots after board or session changes:

```text
data: {"revision":13,"board":{...},"canUndo":true,"sessions":[...]}

```

Heartbeat comments are sent every 15 seconds. Reconnecting clients receive the complete current state, not a partial patch. The browser uses `EventSource` to reconnect automatically. If a board revision changes during a drag/drawing gesture, the browser cancels that gesture to preserve the incoming edit. Drag movements are previewed locally and committed at pointer release.

## Saved sessions

- `GET /sessions`: returns `{id,name,date,board}[]`.
- `POST /sessions`: `{ "name": "U8 protected restart", "expectedRevision": 13 }`; saves the current board and returns the session (`201`).
- `DELETE /sessions/:id`: removes a saved session.
- To load through the API, get a session and `PUT /board` with its `board` and the current revision.
- `POST /sessions/import` is a legacy-migration endpoint accepting `{migrationId,sessions}` where session boards are the former internal browser format. A migration ID is imported at most once. This endpoint is for migration, not generating new setups.

On first connection the browser imports its existing local-storage sessions. The original browser copy is preserved. Active board, history, sessions, and migration receipts are stored in `data/workspace.json` using atomic file replacement. Browser orientation remains a local preference.

## Runnable curl examples

Requires `curl` and `jq`. Start the server with `npm run dev` first.

After backend changes, stop and restart `npm run dev`: frontend hot reload does not reload Express routes. If a documented endpoint returns `404 Unknown API endpoint`, check that the server is running the updated code. Refresh the browser after restarting. For production, run `npm run build`, then restart `npm start`.

```sh
BASE=http://127.0.0.1:5173/api/v1
curl -sS "$BASE/board" | jq
curl -sS "$BASE/schema" | jq

# Apply a protected-restart formation, move the first ball (or add one), and add a pass arrow.
# Any additional balls are preserved.
REV=$(curl -sS "$BASE/board" | jq '.revision')
BALL=$(curl -sS "$BASE/board" | jq -r '[.board.elements[] | select(.type == "ball")][0].id // empty')
ROUTE="restart-pass-$(date +%s)"
jq -n --argjson revision "$REV" --arg ball "$BALL" --arg route "$ROUTE" '{
  expectedRevision: $revision,
  operations: [
    {action: "configure", pitch: "u8", teamSize: 5, formations: {home: "1–2–1", away: "2–2"}},
    (if $ball == "" then {action: "add", element: {id: ($route + "-ball"), type: "ball", position: {x: 8, y: 50}}} else {action: "update", id: $ball, changes: {position: {x: 8, y: 50}}} end),
    {action: "add", element: {id: $route, type: "drawing", start: {x: 8, y: 50}, end: {x: 20, y: 30}, style: "solid", arrow: true}}
  ]
}' | curl -sS -X POST "$BASE/board/operations" -H 'Content-Type: application/json' --data-binary @- | jq

# Add a cone gate and a small target goal as one undoable edit.
REV=$(curl -sS "$BASE/board" | jq '.revision')
PREFIX="exercise-$(date +%s)"
jq -n --argjson revision "$REV" --arg prefix "$PREFIX" '{
  expectedRevision: $revision,
  operations: [
    {action: "add", element: {id: ($prefix + "-left"), type: "small-cone", position: {x: 40, y: 35}, rotation: 0, color: "blue"}},
    {action: "add", element: {id: ($prefix + "-right"), type: "small-cone", position: {x: 40, y: 65}, rotation: 0, color: "blue"}},
    {action: "add", element: {id: ($prefix + "-goal"), type: "goal", position: {x: 75, y: 50}, rotation: 90}}
  ]
}' | curl -sS -X POST "$BASE/board/operations" -H 'Content-Type: application/json' --data-binary @- | jq

# Undo the latest edit.
REV=$(curl -sS "$BASE/board" | jq '.revision')
jq -n --argjson revision "$REV" '{expectedRevision: $revision}' |
  curl -sS -X POST "$BASE/board/undo" -H 'Content-Type: application/json' --data-binary @- | jq
```

## Error responses

- `400`: malformed JSON, invalid/missing undo revision, or nothing to undo.
- `404`: unknown endpoint/session.
- `409`: stale revision, with `{error, revision, board, canUndo}`.
- `422`: invalid document, unknown/duplicate element ID, invalid formation/player count, invalid fields or coordinates. Schema errors include a `details` array with paths.

The local server binds to `127.0.0.1` by default. `PORT` selects a different port; `BOARD_DATA_DIR` selects a different workspace directory. This version is intended for local HTTP-capable agents; it does not embed an LLM provider or require an AI API key.
