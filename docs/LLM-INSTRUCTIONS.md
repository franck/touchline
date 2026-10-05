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
8. Preserve unrelated elements unless the coach asks you to clear them. New IDs must be unique. Empty and partial boards are valid: allow zero or one ball and up to teamSize players per team, with unique shirt numbers 1 through teamSize. Add/delete players and the ball individually using ordinary operations. `configure` with a formation restores that full team but does not add a missing ball.
9. On HTTP 409, reread the board and reconsider your edit against the new state before retrying. On 422, use the error paths to correct your request. Never assume a failed request partially applied.
10. Verify the returned document and describe the actual changes briefly. The browser updates live; no refresh is needed.

For examples, full documents, Undo, and saved-session endpoints, see `docs/API.md`.

To export an image, download `GET /board/export?format=png&orientation=horizontal` (also supports `svg` and `vertical`). Add `expectedRevision=<revision>` to ensure you export the state you reviewed; on 409, reread the board. The response is image bytes, not JSON, with an `X-Board-Revision` header. Export works without a browser and does not edit the board or Undo history. To export a saved session, load its board using the normal `PUT /board` flow first.

To clean a board, use `POST /board/clear` with `{expectedRevision,scope}`. Use `annotations` to remove drawings and equipment while preserving positions; use `reset` to restore both full selected formations and a centred ball; use `everything` to remove every element including all players and the ball. Pitch settings and saved sessions are preserved. The entire clear is one Undo entry.
