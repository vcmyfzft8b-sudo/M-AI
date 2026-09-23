# Synthetic import lessons

These original educational fixtures contain no user content, personal data or
external media. They are for the opt-in staging tests in `WrapperTests.swift`.

- `memo-qa-electric-circuits.pdf`: one-page circuit lesson.
- `memo-qa-electric-circuits-audio.txt`: original script for the audio fixture.
- `memo-qa-electric-circuits-audio.m4a`: approximately 92 seconds of the script,
  synthesized with macOS Samantha at 165 words per minute and converted to mono
  AAC. The native import may use the app's MP3 preparation fallback.
- `memo-qa-circuits-word.docx`: one-page Word lesson adapted from that script,
  with editable headings and paragraphs.
- `memo-qa-circuits-slides.pptx`: three editable text slides covering closed
  circuits, Ohm's law, series/parallel arrangements and electrical power.

The PDF, Word page and every PowerPoint slide were rendered and visually
inspected before import. Office fixtures cover ordinary text extraction;
they do not establish support for embedded media or complex Office layouts.

Put the selected fixture in the dedicated Simulator's Files storage and use a
new synthetic staging account with its normal unused free note for each import.
See `docs/ios-app.md` for environment variables and test selection. Do not
reset quotas or inject generated content to make an import test pass.
