# Block protocol (v1)

The model is asked to end replies with a fenced code block. The extension does not depend on the fence or its label; it finds top-level JSON objects in the reply text, so it still works if the host renders code blocks differently.

## `markflow` (one mark)

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

## `markflow-handover`

```json
{
  "pack": "pk_abc123",
  "rulings": ["Accept a composite key if the report says why a surrogate was not used."],
  "anchors": [{ "student": "S06", "note": "Strong exemplar for C2." }],
  "notes": []
}
```

Nothing from a handover is saved to the pack until the teacher reviews it and chooses what to keep. Saving bumps the pack version.

## Handshake

The pack preamble ends with `Reply only with: READY <pack-id> <protocol>`. The panel shows *Chat configured* once it sees that exact reply in the current chat.
