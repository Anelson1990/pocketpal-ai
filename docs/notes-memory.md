# Notes memory

An optional, OFF-by-default switch (Settings → Notes memory) that lets the model keep a few short notes between chats.

- Tools: `save_note(title, content)`, `search_notes(query)`, `read_note(title)`.
- Storage: plain Markdown files in the app's private folder on the phone (`<app documents>/notes/<title-slug>.md`). Nothing is sent anywhere.
- The model can only add to notes. `save_note` appends to an existing title and never replaces text. There is no delete tool: "Clear all notes" in Settings is the only way to delete, and it asks first.
- Limits: 60-character titles, 4,000 characters per save, 200 notes, about 20,000 characters in total.
- Note text goes back to the model wrapped as untrusted data, so text a web page planted in a note is treated as information, not instructions.
- Search is keyword matching, not semantic search.
- Sharing the folder with another app (for example Obsidian) is not implemented: Android keeps app-private files out of reach of other apps.

Not verified: behavior on a real device, and how well a small model decides when to save or search.
