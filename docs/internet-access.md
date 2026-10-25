# Internet Access toggle

A **Web** pill under the message box lets a local model use web search and read web pages.
The model still runs on-device; only search queries and page reads leave the phone.

## Using it
1. Settings → Internet Search: accept the consent notice, pick a provider, paste your own API key
   (stored in the system keychain, never bundled with the app).
2. Open a chat with a model loaded and tap the **Web** pill (globe icon).
   - OFF: no web tools are offered to the model and no search or page-read requests are made.
     If you ask for live information the model is told to say it cannot look it up.
   - ON: the model may call `web_search` and `read_url`. Search activity is shown in the chat.
   - Tapping it before setup shows a message explaining how to finish setup.
3. Settings → Internet Search also has "Tool calls per reply" (1–10, default 5).

The toggle is app-wide (not per conversation) and takes effect from the next message.
Users who enabled search before this feature keep it ON until they switch it off.

## Safety limits
- Only the registered tools `web_search` and `read_url` can run; arguments are validated
  (query ≤ 400 chars, URL ≤ 2048 chars, http/https only, no embedded credentials).
- `read_url` only opens URLs that came from the user or from a prior search result.
- Web text is wrapped as untrusted content; text that merely looks like a tool call is not executed.
- Per-reply cap on tool calls; the OFF state is enforced in the schema, the run allowlist and
  each engine (a flip mid-reply blocks the next lookup).
- Only the query or URL is sent to the provider, never the conversation.
- No shell or file tools are involved. There are no consequential (write/send) tools, so no approval UI.

## Build and install (Android)
Run from the repo root:

    yarn install
    cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
    adb install -r app/build/outputs/apk/debug/app-debug.apk

The APK path may differ by flavor; check `app/build/outputs/apk/`. The repo's
`.github/workflows/ci.yml` also builds Android in CI (verify its current steps).

## Not verified
- No on-device test and no Android build were done by the author (build env could not reach Maven).
- Model-side Hermes tool-call parsing lives in llama.cpp / llama.rn and is not unit-tested here.
  Which Hermes GGUFs ship a tool-use chat template should be checked per model.

## CI
GitHub Actions (CI Pipeline) builds the Android APK; download it from the run page under Artifacts as `android-release-apk`.
