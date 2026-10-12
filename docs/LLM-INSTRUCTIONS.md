# Editing Touchline with an LLM or agent

You have HTTP access to a live football coaching board.

Default base URL: `http://127.0.0.1:5173/api/v1`.

1. Fetch `GET /schema` and `GET /board` before making changes.
2. Use the board's current IDs and revision. IDs do not equal shirt numbers. Locate players by `type`, `team`, and `number`.
3. Prefer `POST /board/operations` for focused edits. Send `expectedRevision` and an array of `add`, `update`, `delete`, or `configure` operations. Group one coaching action into one batch so the coach can Undo it once.
4. Positions use 0–100 across the playing area, x from home goal to away goal, y top to bottom in horizontal view. These coordinates do not change when the display rotates.
5. Use `configure` to change pitch, team size, or formation presets. Five-, seven-, and eleven-a-side include the goalkeeper. Get exact formation strings from `/schema`; use en dashes.
6. Equipment: `cone`, `small-cone`, `goal`. Provide `position` and `rotation`. Small cones also require `color`: red, green, yellow, or blue. Goals open toward positive y at rotation 0; rotation 90 faces the home goal.
7. Drawings require `start`, `end`, `style` (solid/dotted), and `arrow` (boolean). You can update endpoints and style by ID.
8. Preserve unrelated elements unless the coach asks you to clear them. New IDs must be unique. Empty and partial boards are valid: allow zero or more balls and up to teamSize players in each home/away team, with unique shirt numbers 1 through teamSize. Balls and neutrals do not count toward team size; the overall 2,000-element limit still applies. Add/update/delete each ball by its own ID. `configure` with a formation restores that full team and preserves every neutral and ball but does not add a ball if none exists.
9. On HTTP 409, reread the board and reconsider your edit against the new state before retrying. On 422, use the error paths to correct your request. Never assume a failed request partially applied.
10. Verify the returned document and describe the actual changes briefly. The browser updates live; no refresh is needed.

Neutral players use the normal player shape with `team: "neutral"` and appear yellow. Allow up to 11 neutrals with unique neutral shirt numbers 1–11, independently of team size and home/away numbers. They have no formation. Formation changes, team-size changes, and both reset operations retain their IDs and positions; `everything` removes them. Add, move, renumber, or delete them by ID using ordinary operations. Saved sessions and both export endpoints include neutrals.

For examples, full documents, Undo, and saved-session endpoints, see `docs/API.md`.

## Generate illustrations without editing the live board

Prefer **`POST /board/export` for notes, drills, tactics, and saved-session illustrations**. Read `GET /schema` first: its `export` entry describes the request body. Send `{board: <complete public document>, format: "png", orientation: "horizontal"}`; PNG and horizontal are defaults, and `svg` / `vertical` are also supported. Do not clear, replace, or load the live board merely to generate images.

- Supply the public `schemaVersion: 1` document, not the internal browser `Board` shape. Even sparse diagrams require `pitch`, `teamSize`, and valid home/away formation strings. Explicit positions determine the image; formations do not populate players during export.
- Use the smallest supported team size (5, 7, 11) accommodating each team's illustrated players. Ten same-team children require size 11; one ball per child is supported. Keep IDs unique across all elements.
- Send options in the JSON body. Do not send `expectedRevision`: independent exports neither require it nor return `X-Board-Revision`.
- Responses are image bytes, not JSON. Check status/content type and verify the image before embedding it. On `400` correct JSON syntax; on `422` correct the document/options using the error response. Do not save a JSON error as an image or claim an export succeeded when it failed.
- Keep a plain `.board.json` snapshot beside the image and record orientation separately in the note. Regenerate from that snapshot. Export to a temporary filename when updating an existing image, then replace it only after success.
- To illustrate a saved session, fetch `/sessions` and pass that session's `board` to POST export directly. No live-board load is necessary.
- Only the documented players, balls, cones, goals, and straight drawings are supported. Put role meanings, dimensions, and arrow explanations in the note caption; do not invent fields for text labels, extra team colours, or other equipment.

Both export endpoints work without a browser. POST leaves the board, revision, Undo history, sessions, persisted workspace, and live events unchanged. See the runnable JSON-file export example in `docs/API.md`.

## Export the current live board

Use `GET /board/export?format=png&orientation=horizontal` when the requested image is the current live board (also supports `svg` and `vertical`). Add `expectedRevision=<revision>` to export the state you reviewed; on 409, reread the board. GET returns an `X-Board-Revision` header and does not edit the board or Undo history.

## Clear and reset

Use `POST /board/clear` with `{expectedRevision,scope}`. `annotations` removes drawings and equipment while preserving all positions. `reset` restores both full selected formations and centres all existing balls, retaining their IDs; it adds one centred ball only if none exists. `everything` removes every element including all players and balls. Pitch settings and saved sessions are preserved. The entire clear is one Undo entry.

The browser's **Reset positions** moves only existing players and balls; it never adds missing ones. Both reset operations centre existing balls, so multiple balls overlap until moved apart.

## Server availability

Start the server with `npm run dev` from the Touchline project root. After changing backend code, stop and restart it: frontend hot reload does not reload the API. A `404 Unknown API endpoint` for POST export may indicate an old running server; check `/schema` for the `export` entry. For production, build and restart `npm start`. Report connection or capability problems rather than falling back to modifying the live board for independent exports.
