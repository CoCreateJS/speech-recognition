/*!
 * https://CoCreateJS.com
 * https://github.com/CoCreateJS/CoCreate-speech-recognition
 * Released under the MIT license
 */
import observer from "@cocreate/observer";
import actions from "@cocreate/actions";
import { queryElements } from "@cocreate/utils";
import "./index.css";

const selector = "[speech-recognition-query], [speech-recognition]";
const initialized = new WeakSet();
let session;

function dispatch(element, name, detail = {}) {
	if (!element) return;
	element.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
	const declarativeName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	element.dispatchEvent(new CustomEvent(declarativeName, { bubbles: true, detail }));
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

function setStatus(element, status) {
	if (element?.matches(selector) && element.getAttribute("speech-recognition") !== status)
		element.setAttribute("speech-recognition", status);
}

function getTarget(element, explicitTarget) {
	if (explicitTarget) return explicitTarget;
	if (element?.hasAttribute("speech-recognition-query")) {
		return queryElements({ element, prefix: "speech-recognition" })[0];
	}
	if (element?.matches("input, textarea, [contenteditable='true'], [contenteditable='']"))
		return element;
}

async function getValue(element) {
	if (!element) return "";
	const value = typeof element.getValue === "function" ? await element.getValue() : undefined;
	return String(value ?? ("value" in element ? element.value : element.textContent) ?? "");
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
		interimResults: booleanAttribute(element, "speech-recognition-interim-results", true),
		maxAlternatives: Math.max(1, Math.floor(Number(element?.getAttribute("speech-recognition-alternatives")) || 1))
	};
}

/**
 *
 * @public
 * @environment client
 */
function start(options = {}, element) {
	if (options.nodeType) {
		element = options;
		options = {};
	} else element = element || options.element;
	options = { ...getOptions(element), ...options };

	abort();
	const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
	if (!Constructor) {
		setActive(element, false);
		setStatus(element, "end");
		dispatch(element, "speechRecognitionError", { error: new Error("SpeechRecognition API is not supported.") });
		return;
	}

	let recognition, target, current;
	try {
		recognition = new Constructor();
		target = getTarget(element, options.target);
		if (options.lang) recognition.lang = options.lang;
		recognition.continuous = options.continuous;
		recognition.interimResults = options.interimResults;
		recognition.maxAlternatives = options.maxAlternatives;

		current = { element, recognition, target, ended: false, cancelled: false, stopping: false };
		session = current;
		setActive(element, false);
		setStatus(element, "start");
		// Keep result writes in order, including when the target has async value methods.
		const initialValueReady = getValue(target);
		current.results = Promise.resolve();
		const reportError = (error) => {
			if (session !== current || current.cancelled) return;
			current.cancelled = true;
			current.error = error;
			recognition.abort();
			setActive(element, false);
			dispatch(element, "speechRecognitionError", { error, recognition, target });
		};
		initialValueReady.catch(reportError);

		recognition.addEventListener("start", (event) => {
			if (session !== current || current.cancelled || current.ended) return;
			setActive(element, !current.stopping);
			if (!current.stopping) setStatus(element, "start");
			dispatch(element, "speechRecognitionStart", { event, recognition, target });
		});
		recognition.addEventListener("result", (event) => {
			let finalTranscript = "", interimTranscript = "";
			for (const result of event.results) {
				const transcript = result[0]?.transcript || "";
				if (result.isFinal) finalTranscript += transcript;
				else interimTranscript += transcript;
			}
			const transcript = `${finalTranscript}${interimTranscript}`;
			current.results = current.results.then(async () => {
				const initialValue = await initialValueReady;
				if (session !== current || current.cancelled) return;
				const separator = initialValue && transcript && !/\s$/.test(initialValue) ? " " : "";
				await setValue(target, `${initialValue}${separator}${transcript}`);
				if (session !== current || current.cancelled) return;
				dispatch(element, "speechRecognitionResult", {
					event, recognition, target, transcript, finalTranscript, interimTranscript,
					isFinal: !interimTranscript
				});
			}).catch(reportError);
		});
		recognition.addEventListener("error", (event) => {
			if (session !== current || current.cancelled) return;
			current.error = new Error(event.message || event.error || "Speech recognition failed.");
			setActive(element, false);
			dispatch(element, "speechRecognitionError", { event, recognition, target });
		});
		recognition.addEventListener("end", (event) => {
			current.ended = true;
			if (session === current) {
				setActive(element, false);
				setStatus(element, "end");
			}
			dispatch(element, "speechRecognitionEnd", { event, recognition, target });
		});
		recognition.start();
		return recognition;
	} catch (error) {
		if (current) {
			current.cancelled = true;
			current.ended = true;
		}
		setActive(element, false);
		setStatus(element, "end");
		dispatch(element, "speechRecognitionError", { error, recognition, target });
	}
}

/**
 *
 * @public
 * @environment client
 */
function stop() {
	if (!session || session.ended || session.cancelled || session.stopping) return;
	session.recognition.stop();
	session.stopping = true;
	if (!session.ended) {
		setActive(session.element, false);
		setStatus(session.element, "stop");
	}
}

/**
 *
 * @public
 * @environment client
 */
function abort() {
	if (!session || session.cancelled) return;
	const current = session;
	current.cancelled = true;
	if (current.ended) return;
	setActive(current.element, false);
	setStatus(current.element, "abort");
	current.recognition.abort();
	dispatch(current.element, "speechRecognitionAbort", {
		recognition: current.recognition, target: current.target
	});
}

/**
 *
 * @public
 * @environment client
 */
function toggle(element) {
	if (session?.element === element && !session.ended && !session.cancelled) return stop();
	return start(element);
}

function applyCommand(element) {
	const command = element.getAttribute("speech-recognition");
	const ownsSession = session?.element === element;
	if (command === "start") {
		if (ownsSession && !session.ended && !session.cancelled && !session.stopping) return;
		start(element);
	} else if (ownsSession && command === "stop") stop();
	else if (ownsSession && command === "abort") abort();
}

/**
 *
 * @public
 * @environment client
 */
function init(elements = document.querySelectorAll(selector)) {
	if (elements.nodeType) elements = [elements];
	for (const element of elements) {
		if (!element.matches(selector)) continue;
		if (!initialized.has(element)) {
			initialized.add(element);
			setActive(element, false);
			element.addEventListener("click", () => {
				if (
					element.matches(selector) && !element.hasAttribute("actions") &&
					!element.disabled && element.getAttribute("aria-disabled") !== "true"
				)
					toggle(element);
			});
		}
		applyCommand(element);
	}
}

function runAction(action) {
	const methods = {
		speechRecognitionStart: "start",
		speechRecognitionStop: "stop",
		speechRecognitionAbort: "abort"
	};
	let method = action.method || methods[action.name] || "toggle";
	if (method === "toggle") {
		method = session?.element === action.element && !session.ended && !session.cancelled ? "stop" : "start";
	}
	if (!["start", "stop", "abort"].includes(method)) {
		action.abort(new Error(`Unknown speech recognition method: ${method}`));
		return;
	}

	const recognition = method === "start" ? start(action.element) : session?.recognition;
	if (method === "start" && !recognition) {
		action.abort(new Error("Speech recognition could not start."));
		return;
	}
	if (!recognition || (method !== "start" && (session.ended || session.cancelled))) {
		action.end();
		return;
	}

	const current = session;
	// The Actions chain advances on browser confirmation, not the command call.
	return new Promise((resolve) => {
		const completedEvent = method === "start" ? "start" : "end";
		const cleanup = () => {
			recognition.removeEventListener(completedEvent, complete);
			recognition.removeEventListener("error", fail);
			recognition.removeEventListener("end", ended);
		};
		const complete = async (event) => {
			cleanup();
			if (method === "stop") {
				await current.results;
				if (current.error || current.cancelled) {
					action.abort(current.error || new Error("Speech recognition was aborted."));
					resolve();
					return;
				}
			}
			action.end({ event, recognition });
			resolve();
		};
		const fail = (event) => {
			if (method === "abort" && event.error === "aborted") return;
			cleanup();
			action.abort(new Error(event.message || event.error || "Speech recognition failed."));
			resolve();
		};
		const ended = () => {
			cleanup();
			action.abort(new Error("Speech recognition ended before starting."));
			resolve();
		};
		recognition.addEventListener(completedEvent, complete, { once: true });
		recognition.addEventListener("error", fail);
		if (method === "start") recognition.addEventListener("end", ended, { once: true });
		try {
			if (method === "stop") stop();
			else if (method === "abort") abort();
		} catch (error) {
			cleanup();
			action.abort(error);
			resolve();
		}
	});
}

actions.init({
	name: ["speechRecognition", "speechRecognitionStart", "speechRecognitionStop", "speechRecognitionAbort"],
	endEvent: "speechRecognitionActionEnd",
	callback: runAction
});

observer.init({
	name: "CoCreateSpeechRecognitionAddedNodes",
	types: ["addedNodes"],
	selector,
	callback: (mutation) => init(mutation.target)
});

observer.init({
	name: "CoCreateSpeechRecognitionAttributes",
	types: ["attributes"],
	attributeFilter: ["speech-recognition", "speech-recognition-query"],
	callback: (mutation) => {
		if (mutation.target.matches(selector)) init(mutation.target);
		else if (session?.element === mutation.target) abort();
	}
});

init();

export default { init, start, stop, abort, toggle };

/**
 *
 * @name actions
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name aria-disabled
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name speech-recognition
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name speech-recognition-active
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name speech-recognition-alternatives
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name speech-recognition-lang
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name speech-recognition-query
 * @kind member
 * @attribute
 * @environment client
 */

/**
 * Declarative speech-to-text for CoCreate using the browser SpeechRecognition API.
 *
 * @module speech-recognition
 * @environment client
 */

/**
 * Declarative selectors recognized by this module.
 *
 * @name declarative-selectors
 * @kind member
 * @selectors
 * @environment client
 * @example
 * ```json
 * [
 *   "[speech-recognition-query], [speech-recognition]"
 * ]
 * ```
 */
