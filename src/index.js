/*!
 * https://cocreate.app
 * https://github.com/CoCreate-app/CoCreate-speech-recognition
 * Released under the MIT license
 */
import observer from "@cocreate/observer";
import { queryElements } from "@cocreate/utils";
import "./index.css";

const initialized = new WeakSet();
let activeElement;
let activeRecognition;

const Recognition = () =>
	globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

function dispatch(element, name, detail = {}) {
	element?.dispatchEvent(
		new CustomEvent(name, { bubbles: true, detail })
	);
	const declarativeName = name.replace(/[A-Z]/g, (letter) =>
		`-${letter.toLowerCase()}`
	);
	if (declarativeName !== name) {
		element?.dispatchEvent(
			new CustomEvent(declarativeName, { bubbles: true, detail })
		);
	}
}

function booleanAttribute(element, name, fallback = false) {
	if (!element?.hasAttribute(name)) return fallback;
	return element.getAttribute(name) !== "false";
}

function setActive(element, active) {
	if (!element) return;
	if (active) element.setAttribute("speech-recognition-active", "true");
	else element.removeAttribute("speech-recognition-active");
}

function getTarget(element, explicitTarget) {
	if (explicitTarget) return explicitTarget;
	if (element?.hasAttribute("speech-recognition-query")) {
		return queryElements({
			element,
			prefix: "speech-recognition"
		})[0];
	}
	if (
		element?.matches?.("input, textarea, [contenteditable='true'], [contenteditable='']")
	)
		return element;
}

async function getValue(element) {
	if (!element) return "";
	let value;
	if (typeof element.getValue === "function") value = await element.getValue();
	if (value === undefined || value === null)
		value = "value" in element ? element.value : element.textContent;
	return String(value || "");
}

async function setValue(element, value) {
	if (!element) return;
	if (typeof element.setValue === "function") await element.setValue(value);
	else if ("value" in element) element.value = value;
	else element.textContent = value;
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

function getOptions(element) {
	return {
		lang: element?.getAttribute("speech-recognition-lang") || undefined,
		continuous: booleanAttribute(element, "speech-recognition-continuous"),
		interimResults: booleanAttribute(
			element,
			"speech-recognition-interim-results",
			true
		),
		maxAlternatives: Math.max(
			1,
			Number(element?.getAttribute("speech-recognition-alternatives")) || 1
		)
	};
}

function start(options = {}, element) {
	if (options?.nodeType) {
		element = options;
		options = {};
	} else if (options.element && !element) {
		element = options.element;
	}

	const Constructor = Recognition();
	if (!Constructor) {
		const error = new Error("SpeechRecognition API is not supported.");
		dispatch(element, "speechRecognitionError", { error });
		return;
	}

	abort();
	const recognition = new Constructor();
	const target = getTarget(element, options.target);
	let initialValue = "";
	const initialValueReady = getValue(target).then((value) => {
		initialValue = value;
	});
	recognition.lang = options.lang || "";
	recognition.continuous = options.continuous ?? false;
	recognition.interimResults = options.interimResults ?? true;
	recognition.maxAlternatives = options.maxAlternatives ?? 1;

	activeElement = element;
	activeRecognition = recognition;
	setActive(element, true);

	recognition.addEventListener("start", (event) =>
		dispatch(element, "speechRecognitionStart", { event, recognition, target })
	);
	recognition.addEventListener("result", async (event) => {
		await initialValueReady;
		let finalTranscript = "";
		let interimTranscript = "";
		for (let index = 0; index < event.results.length; index++) {
			const transcript = event.results[index][0]?.transcript || "";
			if (event.results[index].isFinal) finalTranscript += transcript;
			else interimTranscript += transcript;
		}
		const transcript = `${finalTranscript}${interimTranscript}`;
		const separator = initialValue && !/\s$/.test(initialValue) ? " " : "";
		await setValue(target, `${initialValue}${separator}${transcript}`);
		dispatch(element, "speechRecognitionResult", {
			event,
			recognition,
			target,
			transcript,
			finalTranscript,
			interimTranscript,
			isFinal: !interimTranscript
		});
	});
	recognition.addEventListener("error", (event) => {
		dispatch(element, "speechRecognitionError", { event, recognition, target });
	});
	recognition.addEventListener("end", (event) => {
		if (activeRecognition === recognition) {
			setActive(element, false);
			activeElement = undefined;
			activeRecognition = undefined;
		}
		dispatch(element, "speechRecognitionEnd", { event, recognition, target });
	});

	try {
		recognition.start();
		return recognition;
	} catch (error) {
		setActive(element, false);
		activeElement = undefined;
		activeRecognition = undefined;
		dispatch(element, "speechRecognitionError", { error, recognition, target });
	}
}

function stop() {
	activeRecognition?.stop();
}

function abort() {
	const element = activeElement;
	activeRecognition?.abort();
	setActive(element, false);
	activeElement = undefined;
	activeRecognition = undefined;
	if (element) dispatch(element, "speechRecognitionAbort");
}

function toggle(element) {
	if (element === activeElement) return stop();
	return start(getOptions(element), element);
}

function initElements(elements) {
	for (const element of elements) {
		if (!element || initialized.has(element)) continue;
		initialized.add(element);
		element.addEventListener("click", () => toggle(element));
	}
}

function init() {
	initElements(document.querySelectorAll("[speech-recognition]"));
}

let observerInitialized = false;
function initObserver() {
	if (observerInitialized) return;
	observerInitialized = true;

	observer.init({
		name: "CoCreateSpeechRecognitionAddedNodes",
		types: ["addedNodes"],
		selector: "[speech-recognition]",
		callback: (mutation) => initElements([mutation.target])
	});

	observer.init({
		name: "CoCreateSpeechRecognitionAttributes",
		types: ["attributes"],
		attributeFilter: ["speech-recognition"],
		selector: "[speech-recognition]",
		callback: (mutation) => initElements([mutation.target])
	});
}

if (globalThis.CoCreate?.observer) initObserver();
else document.addEventListener("observerLoaded", initObserver, { once: true });

init();

export default { init, start, stop, abort };
