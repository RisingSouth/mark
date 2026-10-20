# Block protocol (v1)

The model is asked to end replies with a fenced code block. The extension does not depend on the fence or its label; it finds top-level JSON objects in the reply text, so it still works if the host renders code blocks differently.

## `mark` (one mark)

```json
{
  "pack": "pk_abc123",
  "student": "S08",
  "scores": { "C1": 4, "C2": 3, "C3": 4, "C4": 3 },
  "total": 14,
  "of": 20,
  "confidence": "med",
  "flags": ["C3 between anchors A2 and A3"],
  "comment": "One or two sentences of student-facing feedback."
}
```

Rules enforced before saving:

- `student` matches `[A-Za-z0-9_-]{1,24}`. Names with spaces are rejected on purpose.
- `scores` contains exactly the pack's criterion IDs, each a whole number from 0 to that criterion's max.
- `total`, if present, equals the sum of `scores`. (The stored total is always the computed sum.)
- `confidence` is `low`, `med` or `high` (default `med`). A `low` confidence or any `flags` puts the mark in the review queue.

## `mark-handover`

```json
{
  "pack": "pk_abc123",
  "rulings": ["Accept a composite key if the report says why a surrogate was not used."],
  "anchors": [{ "student": "S06", "note": "Strong exemplar for C2." }],
  "notes": []
}
```

Nothing from a handover is saved to the pack until the teacher reviews it and chooses what to keep. Saving bumps the pack version.

## `mark-pack` (rubric import)

```json
{
  "name": "Database Task",
  "task": "Design a relational database for a school library.",
  "statedTotal": 20,
  "criteria": [{ "id": "C1", "name": "Schema design", "max": 5, "descriptor": "Top band: ..." }]
}
```

Requested by **Import rubric from files**. The teacher attaches the task sheet and rubric to the chat; the reply is captured into a review screen and nothing is saved until the teacher accepts it.

- Structural errors block saving: no criteria, duplicate or malformed IDs, missing names, `max` not a whole number from 1 to 100.
- `statedTotal` is the total printed in the document. If it is missing, or differs from the sum of the criterion maxes, the review screen warns and the teacher must tick a confirmation before saving.
- Level bands across columns are one criterion with `max` set to the top of the range; levels live in `descriptor`.

Anchors are imported with the `mark-handover` format below, using each anchor's `score`.

## Handshake

The pack preamble ends with `Reply only with: READY <pack-id> <protocol>`. The panel shows *Chat configured* once it sees that exact reply in the current chat.
