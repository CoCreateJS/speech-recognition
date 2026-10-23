# CoCreate Speech Recognition

Declarative speech-to-text for CoCreate using the browser SpeechRecognition API.
Observer initializes existing and dynamically added controls directly from the
imported module; there is no `observerLoaded` dependency.

## Attribute API

```html
<textarea id="message"></textarea>
<button type="button"
    speech-recognition-query="$document #message"
    speech-recognition-lang="en-US"
    aria-label="Start dictation">
    <i aria-hidden="true">●</i>
    <i aria-hidden="true">■</i>
</button>
```

`speech-recognition-query` is sufficient to initialize a control; a separate empty
`speech-recognition` attribute is optional. Observer discovers controls with either
attribute, on load, when added, or when either attribute is added later. Clicking
a query-only control creates its `speech-recognition` lifecycle attribute.

Click to start; click again to stop and keep the final transcript. Without a
query, inputs, textareas, and contenteditable triggers receive their own
transcript. Other triggers emit result events without writing a value.

| Attribute | Default / behavior |
| --- | --- |
| `speech-recognition` | Empty: idle toggle. `start`, `stop`, `abort`: commands; `end`: session completed. |
| `speech-recognition-query` | CoCreate target query; the first match receives text. |
| `speech-recognition-lang` | Browser default language when omitted. |
| `speech-recognition-continuous` | `false` |
| `speech-recognition-interim-results` | `true` |
| `speech-recognition-alternatives` | Positive integer, default `1`. |

Boolean options accept an empty value or `true` to enable and `false` to disable.
Options and targets are read when recognition starts. Initialization is idempotent;
removing both `speech-recognition` and `speech-recognition-query` aborts that
trigger's session and disables its click handling.

### Attribute commands

Observer executes changes to the `speech-recognition` value:

```js
const control = document.querySelector("[speech-recognition]");
control.setAttribute("speech-recognition", "start");
control.setAttribute("speech-recognition", "stop");
control.setAttribute("speech-recognition", "abort");
```

Each line illustrates a separate command. CoCreate Events can assign the same
attribute declaratively. Initial markup and dynamically added elements with
`speech-recognition="start"` also request recognition immediately, subject to the
browser's microphone permission requirements. An empty attribute initializes the
click toggle without starting automatically.

`start` uses the element's existing target and options. Reapplying it while that
control is already starting or listening does not restart recognition. `stop` and
`abort` affect only the session owned by that control. Direct clicks continue to
toggle regardless of the last command value.

Clicks and API calls synchronize the main attribute using the native API names:

| Value | Meaning |
| --- | --- |
| `start` | Start requested; remains while recognition listens. |
| `stop` | Stop requested; final recognition results may still arrive. |
| `abort` | Cancellation requested; pending results are discarded. |
| `end` | The browser has confirmed disconnection, or startup failed synchronously. |

Clicks toggle from idle/end to `start`, then from a running session to `stop`.
Natural completion and completion after stop or abort set `end` when the native
`end` event arrives. Empty markup stays idle until clicked or commanded. `end`
is a status value, not a command. Repeated values do not repeat operations, and
late events from an older session cannot overwrite the current session's status.
Removing both initialization attributes aborts the session without restoring them.

Use `speech-recognition-active` to distinguish actual listening from a pending
start request, and the existing events for lifecycle reactions. In event configuration,
`speech-recognition-start.aria-label` is an Events assignment triggered by the
start event; it is not a recognition command.

The component sets `speech-recognition-active="true"` on browser start and removes
it on stop, abort, error, or end. The bundled CSS uses this attribute to switch the
first and last icons. It is an output attribute; changing it does not start or
stop recognition. The component keeps only the transient session information
needed to control the browser recognizer and order asynchronous transcript writes.
It does not manage application state, labels, or tooltips.

### Optional icon styling

`speech-recognition-active` is the built-in listening flag. When it equals
`"true"`, recognition is listening; when absent, it is inactive. This reflects the
browser session without requiring event handlers or a separate application state.
It is independent of the lifecycle events, JavaScript API, Actions, and Observer;
use whichever integration suits the UI.

The two-icon example above works with the bundled CSS. Custom markup can use the
same flag directly:

```html
<button type="button" speech-recognition
    speech-recognition-query="$document #message" aria-label="Dictation">
    <span class="dictation-idle" aria-hidden="true">●</span>
    <span class="dictation-listening" aria-hidden="true">■</span>
</button>
```

```css
[speech-recognition] .dictation-listening { display: none; }
[speech-recognition-active="true"] .dictation-idle { display: none; }
[speech-recognition-active="true"] .dictation-listening { display: inline; }
```

No additional state attribute or icon-management JavaScript is needed.

An accessible label should describe the button's current action: “Start dictation”
or “Stop dictation”. Tooltips are optional. Use CoCreate Events to update the label:

```html
<button type="button" speech-recognition
    speech-recognition-query="$document #message"
    aria-label="Start dictation"
    event-name="dictation-on,dictation-off"
    dictation-on-events="speech-recognition-start"
    dictation-on.aria-label="Stop dictation"
    dictation-off-events="speech-recognition-end,speech-recognition-error,speech-recognition-abort"
    dictation-off.aria-label="Start dictation">
    <i aria-hidden="true">●</i>
    <i aria-hidden="true">■</i>
</button>
```

## Optional Actions integration

Direct click-to-toggle behavior does not require an `actions` attribute. When a
trigger has `actions`, the Actions module owns the click, preventing duplicate
execution. Actions work without a `speech-recognition` marker as well.

```html
<button type="button" actions="speechRecognition.start, nextAction"
    speech-recognition-query="$document #message">Start</button>
<button type="button" actions="speechRecognition.stop, nextAction">Stop</button>
<button type="button" actions="speechRecognition.abort, nextAction">Cancel</button>
```

`nextAction` represents another action registered by your application. The start
chain advances after the browser's `start` event; stop and abort advance after
`end`. Stop also waits for queued transcript writes so the next action sees the
final target value. Failures abort the action chain. Stopping or aborting an idle recognizer
completes immediately.

`speechRecognition` and `speechRecognition.toggle` toggle recognition.
`speechRecognitionStart`, `speechRecognitionStop`, and `speechRecognitionAbort`
are aliases. Action completion uses `speechRecognitionActionEnd` (or the Actions
module's invocation event for dotted methods), independently of lifecycle events.

## JavaScript API

```js
CoCreate.speechRecognition.start({
    target: document.querySelector("#message"),
    lang: "en-US",
    continuous: true,
    interimResults: true,
    maxAlternatives: 1
});

// Element calls read its declarative options; explicit options override them.
CoCreate.speechRecognition.start(document.querySelector("[speech-recognition]"));
CoCreate.speechRecognition.toggle(document.querySelector("[speech-recognition]"));
CoCreate.speechRecognition.stop();
CoCreate.speechRecognition.abort();
```

`init()` initializes the document; `init(element)` or `init(elements)` initializes
specific controls. Only one recognition session runs at a time. Starting another
aborts the previous session. `stop()` keeps final results; `abort()` discards
pending results. Transcript updates append to the target's initial value and
replace interim text as it changes. Async target value methods run in result
order. Results from an aborted or replaced session are ignored before writing;
a custom async `setValue` that has already begun manages cancellation of its own
in-progress work.

## Events

The trigger emits bubbling `speechRecognitionStart`, `speechRecognitionResult`,
`speechRecognitionEnd`, `speechRecognitionAbort`, and `speechRecognitionError`
events. Each has a kebab-case alias, such as `speech-recognition-start` or
`speech-recognition-result`, for declarative event bindings. Result details
include `transcript`, `finalTranscript`, `interimTranscript`, `isFinal`,
`recognition`, and `target`.

Speech recognition requires microphone permission and browser support.

## License

[MIT](./LICENSE)
