# CoCreate Speech Recognition

Declarative speech-to-text for CoCreate using the browser SpeechRecognition API.
Elements added after page load are initialized through CoCreate Observer.

## Attribute API

```html
<textarea id="message"></textarea>
<button
	speech-recognition
	speech-recognition-query="$document #message"
	speech-recognition-lang="en-US"
	speech-recognition-continuous="true"
	speech-recognition-interim-results="true">
	Start dictation
</button>
```

Without a query, inputs, textareas, and contenteditable triggers receive their
own transcript. Other triggers emit result events without writing a value.

## JavaScript API

```js
CoCreate.speechRecognition.start({
	target: document.querySelector("#message"),
	lang: "en-US",
	continuous: true,
	interimResults: true,
	maxAlternatives: 1
});

CoCreate.speechRecognition.stop();
CoCreate.speechRecognition.abort();
```

The trigger emits bubbling `speechRecognitionStart`,
`speechRecognitionResult`, `speechRecognitionEnd`, `speechRecognitionAbort`,
and `speechRecognitionError` events.

Speech recognition requires an explicit user gesture, microphone permission,
and browser support.

## License

[MIT](./LICENSE)
