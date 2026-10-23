const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/index.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export default { init, start, stop, abort, toggle };', 'this.api = { init, start, stop, abort, toggle };');

class Element extends EventTarget {
    nodeType = 1;
    value = '';
    attributes = new Map([['speech-recognition', '']]);
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches(selector) { return selector.split(',').some(part => {
        const match = /^\[([\w-]+)\]$/.exec(part.trim());
        return match && this.hasAttribute(match[1]);
    }); }
}
function runtime(supported = true, command, queryOnly = false) {
    const element = new Element(), target = new Element(), observers = [], instances = [], definitions = [];
    if (queryOnly) {
        element.removeAttribute('speech-recognition');
        element.setAttribute('speech-recognition-query', '#transcript');
    }
    if (command !== undefined) element.setAttribute("speech-recognition", command);
    class Recognition extends EventTarget {
        lang = 'browser-default';
        stops = 0;
        aborts = 0;
        constructor() { super(); instances.push(this); }
        start() { if (this.constructor.failure) throw this.constructor.failure; }
        stop() { this.stops++; }
        abort() { this.aborts++; }
    }
    const context = {
        window: supported ? { SpeechRecognition: Recognition } : {},
        document: { querySelectorAll: () => [element] },
        observer: { init: config => observers.push(config) },
        actions: { init: config => definitions.push(config) },
        queryElements: () => [target], Event, CustomEvent
    };
    vm.runInNewContext(source, context);
    return { api: context.api, element, target, observers, instances, Recognition, definitions };
}
const active = element => element.getAttribute('speech-recognition-active') === 'true';
function result(recognition, text, isFinal = true) {
    const event = new Event('result');
    event.results = [Object.assign([{ transcript: text }], { isFinal })];
    recognition.dispatchEvent(event);
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('import registers observers immediately and repeated initialization binds one click', () => {
    const app = runtime();
    assert.equal(app.observers.length, 2);
    app.api.init(app.element);
    app.api.init([app.element]);
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 1);
    assert.equal(app.instances[0].stops, 0);
    assert.equal(active(app.element), false);
});

test('DOM options apply to start(element) and recording state follows browser events', () => {
    const { api, element } = runtime();
    element.setAttribute('speech-recognition-lang', 'es-GT');
    element.setAttribute('speech-recognition-continuous', 'true');
    const recognition = api.start(element);
    assert.equal(recognition.lang, 'es-GT');
    assert.equal(recognition.continuous, true);
    recognition.dispatchEvent(new Event('start'));
    assert.equal(active(element), true);
    assert.equal(element.getAttribute('speech-recognition-active'), 'true');
    api.stop(); api.stop();
    assert.equal(recognition.stops, 1);
    assert.equal(active(element), false);
    recognition.dispatchEvent(new Event('end'));
    assert.equal(active(element), false);
    assert.equal(element.hasAttribute('speech-recognition-active'), false);
});

test('API overrides DOM options and preserves the browser default language', () => {
    const { api, element } = runtime();
    element.setAttribute('speech-recognition-continuous', 'true');
    assert.equal(api.start({ element, continuous: false }).continuous, false);
    assert.equal(api.start(element).lang, 'browser-default');
});

test('interim and final transcripts replace the session output and emit both event names', async () => {
    const { api, element, target } = runtime();
    element.setAttribute('speech-recognition-query', '#target');
    target.value = 'Hello';
    let camel = 0, dashed = 0, inputs = 0;
    element.addEventListener('speechRecognitionResult', () => camel++);
    element.addEventListener('speech-recognition-result', () => dashed++);
    target.addEventListener('input', () => inputs++);
    const recognition = api.start(element);
    result(recognition, 'wor', false);
    await flush();
    assert.equal(target.value, 'Hello wor');
    result(recognition, 'world');
    recognition.dispatchEvent(new Event('end'));
    await flush();
    assert.equal(target.value, 'Hello world');
    assert.equal(camel, 2); assert.equal(dashed, 2); assert.equal(inputs, 2);
});

test('aborted sessions cannot write delayed results or reset a replacement session', async () => {
    const { api, element, target } = runtime();
    let release;
    target.getValue = () => new Promise(resolve => { release = resolve; });
    const old = api.start({ element, target });
    result(old, 'stale');
    const current = api.start(element);
    current.dispatchEvent(new Event('start'));
    old.dispatchEvent(new Event('start'));
    old.dispatchEvent(new Event('error'));
    old.dispatchEvent(new Event('end'));
    release('Original');
    await flush();
    assert.equal(target.value, '');
    assert.equal(active(element), true);
    assert.equal(old.aborts, 1);
});

test('asynchronous result writes are serialized', async () => {
    const { api, element, target } = runtime();
    let release;
    const writes = [];
    target.setValue = async value => {
        writes.push(value);
        if (value === 'first') await new Promise(resolve => { release = resolve; });
        target.value = value;
    };
    const recognition = api.start({ element, target });
    result(recognition, 'first'); result(recognition, 'second');
    await flush();
    assert.deepEqual(writes, ['first']);
    release();
    await flush();
    assert.deepEqual(writes, ['first', 'second']);
    assert.equal(target.value, 'second');
});

test('unsupported browsers, synchronous failures and recognition errors clear active state', () => {
    const unsupported = runtime(false);
    assert.equal(unsupported.api.start(unsupported.element), undefined);
    assert.equal(active(unsupported.element), false);
    const { api, element, Recognition } = runtime();
    Recognition.failure = new Error('start failed');
    assert.equal(api.start(element), undefined);
    assert.equal(active(element), false);
    Recognition.failure = null;
    const recognition = api.start(element);
    recognition.dispatchEvent(new Event('start'));
    recognition.dispatchEvent(new Event('error'));
    recognition.dispatchEvent(new Event('end'));
    assert.equal(active(element), false);
});

test('removing the marker stops recognition and disables the existing click listener', () => {
    const { api, element, observers, instances } = runtime();
    const recognition = api.start(element);
    element.removeAttribute('speech-recognition');
    observers[1].callback({ target: element });
    assert.equal(recognition.aborts, 1);
    assert.equal(active(element), false);
    element.dispatchEvent(new Event('click'));
    assert.equal(instances.length, 1);
    element.setAttribute('speech-recognition', '');
    observers[1].callback({ target: element });
    element.dispatchEvent(new Event('click'));
    assert.equal(instances.length, 2);
});

test('async target failures emit an error without an unhandled rejection', async () => {
    const { api, element, target } = runtime();
    target.getValue = async () => { throw new Error('read failed'); };
    let errors = 0;
    element.addEventListener('speechRecognitionError', () => errors++);
    api.start({ element, target });
    await flush();
    assert.equal(errors, 1);
    assert.equal(active(element), false);
});


function invoke(app, method) {
    const calls = [];
    const promise = app.definitions[0].callback({
        name: 'speechRecognition', method, element: app.element,
        end: detail => calls.push({ type: 'end', detail }),
        abort: error => calls.push({ type: 'abort', error })
    });
    return { calls, promise };
}

test('optional start action waits for browser start before completing', async () => {
    const app = runtime();
    const action = invoke(app, 'start');
    assert.equal(action.calls.length, 0);
    app.instances[0].dispatchEvent(new Event('start'));
    await action.promise;
    assert.equal(action.calls[0].type, 'end');
    assert.equal(action.calls[0].detail.recognition, app.instances[0]);
});

test('stop and abort actions wait for browser end', async () => {
    for (const method of ['stop', 'abort']) {
        const app = runtime();
        const recognition = app.api.start(app.element);
        recognition.dispatchEvent(new Event('start'));
        const action = invoke(app, method);
        assert.equal(action.calls.length, 0);
        if (method === 'abort') {
            const event = new Event('error'); event.error = 'aborted';
            recognition.dispatchEvent(event);
        }
        recognition.dispatchEvent(new Event('end'));
        await action.promise;
        assert.equal(action.calls[0].type, 'end');
    }
});

test('recognition failure explicitly aborts the action chain', async () => {
    const app = runtime();
    const action = invoke(app, 'start');
    const failure = new Event('error'); failure.error = 'not-allowed';
    app.instances[0].dispatchEvent(failure);
    await action.promise;
    assert.equal(action.calls[0].type, 'abort');
    assert.match(action.calls[0].error.message, /not-allowed/);
    const unsupported = runtime(false);
    assert.equal(invoke(unsupported, 'start').calls[0].type, 'abort');
});

test('an interrupted start action aborts instead of leaving the chain waiting', async () => {
    const app = runtime();
    const action = invoke(app, 'start');
    app.api.abort();
    app.instances[0].dispatchEvent(new Event('end'));
    await action.promise;
    assert.equal(action.calls[0].type, 'abort');
    assert.match(action.calls[0].error.message, /ended before starting/);
});

test('action markers suppress the automatic click handler to avoid double execution', () => {
    const app = runtime();
    app.element.setAttribute('actions', 'speechRecognition.start');
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 0);
    const action = invoke(app, 'start');
    app.instances[0].dispatchEvent(new Event('start'));
    assert.equal(action.calls.length, 1);
});

test('idle stop actions complete and unknown methods abort', async () => {
    const app = runtime();
    assert.equal(invoke(app, 'stop').calls[0].type, 'end');
    assert.equal(invoke(app, 'unknown').calls[0].type, 'abort');
    const action = invoke(app);
    app.instances[0].dispatchEvent(new Event('start'));
    await action.promise;
    const stop = invoke(app);
    app.instances[0].dispatchEvent(new Event('end'));
    await stop.promise;
    assert.equal(stop.calls[0].type, 'end');
});

test('added-node initialization binds once and leaves presentation to the application', () => {
    const { observers, instances } = runtime();
    const element = new Element();
    element.setAttribute('aria-label', 'Dictate');
    observers[0].callback({ target: element });
    observers[0].callback({ target: element });
    element.dispatchEvent(new Event('click'));
    assert.equal(instances.length, 1);
    instances[0].dispatchEvent(new Event('start'));
    assert.equal(element.getAttribute('aria-label'), 'Dictate');
    assert.equal(element.getAttribute('title'), null);
    assert.equal(element.getAttribute('aria-pressed'), null);
    assert.equal(element.getAttribute('speech-recognition-state'), null);
});

test('a stop action flushes the final transcript before advancing the chain', async () => {
    const app = runtime();
    let release;
    app.target.setValue = async value => {
        await new Promise(resolve => { release = resolve; });
        app.target.value = value;
    };
    const recognition = app.api.start({ element: app.element, target: app.target });
    result(recognition, 'Final transcript');
    await flush();
    const action = invoke(app, 'stop');
    recognition.dispatchEvent(new Event('end'));
    await flush();
    assert.equal(action.calls.length, 0);
    release();
    await action.promise;
    assert.equal(app.target.value, 'Final transcript');
    assert.equal(action.calls[0].type, 'end');
});

function command(app, value, element = app.element) {
    const oldValue = element.getAttribute('speech-recognition');
    element.setAttribute('speech-recognition', value);
    app.observers[1].callback({ target: element, oldValue });
}

test('Observer executes start, stop and abort attribute commands without a click', () => {
    const app = runtime();
    command(app, 'start');
    const first = app.instances[0];
    first.dispatchEvent(new Event('start'));
    assert.equal(active(app.element), true);
    command(app, 'start');
    app.api.init(app.element);
    assert.equal(app.instances.length, 1);
    command(app, 'stop');
    assert.equal(first.stops, 1);
    assert.equal(active(app.element), false);
    first.dispatchEvent(new Event('end'));
    command(app, 'start');
    const second = app.instances[1];
    command(app, 'abort');
    assert.equal(second.aborts, 1);
    assert.equal(app.element.getAttribute('speech-recognition'), 'abort');
});

test('initial and dynamically added start commands initialize recognition', () => {
    const initial = runtime(true, 'start');
    assert.equal(initial.instances.length, 1);
    const app = runtime();
    const added = new Element();
    added.setAttribute('speech-recognition', 'start');
    app.observers[0].callback({ target: added });
    assert.equal(app.instances.length, 1);
    app.observers[1].callback({ target: added, oldValue: null });
    assert.equal(app.instances.length, 1);
});

test('stop and abort commands on unrelated controls leave the active session running', () => {
    const app = runtime();
    command(app, 'start');
    const other = new Element();
    command(app, 'stop', other);
    command(app, 'abort', other);
    assert.equal(app.instances[0].stops, 0);
    assert.equal(app.instances[0].aborts, 0);
});

test('empty markers remain click toggles and lifecycle events synchronize status', () => {
    const app = runtime();
    assert.equal(app.instances.length, 0);
    command(app, 'start');
    const recognition = app.instances[0];
    recognition.dispatchEvent(new Event('start'));
    recognition.dispatchEvent(new Event('end'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'end');
    assert.equal(active(app.element), false);
    command(app, '');
    assert.equal(app.instances.length, 1);
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 2);
});

test('synchronous stop failures abort the action chain', async () => {
    const app = runtime();
    const recognition = app.api.start(app.element);
    recognition.stop = () => { throw new Error('stop failed'); };
    const action = invoke(app, 'stop');
    await action.promise;
    assert.equal(action.calls[0].type, 'abort');
    assert.match(action.calls[0].error.message, /stop failed/);
});


test('clicks synchronize start and stop while Observer feedback remains idempotent', () => {
    const app = runtime();
    app.element.dispatchEvent(new Event('click'));
    const recognition = app.instances[0];
    assert.equal(app.element.getAttribute('speech-recognition'), 'start');
    command(app, 'start');
    recognition.dispatchEvent(new Event('start'));
    assert.equal(app.instances.length, 1);
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'stop');
    command(app, 'stop');
    assert.equal(recognition.stops, 1);
    recognition.dispatchEvent(new Event('end'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'end');
    command(app, 'end');
    assert.equal(app.instances.length, 1);
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 2);
});

test('abort status remains pending until native end and does not toggle into abort', () => {
    const app = runtime();
    const recognition = app.api.start(app.element);
    app.api.abort();
    assert.equal(app.element.getAttribute('speech-recognition'), 'abort');
    command(app, 'abort');
    assert.equal(recognition.aborts, 1);
    recognition.dispatchEvent(new Event('end'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'end');
});

test('old native end cannot overwrite a replacement session and removed markers stay removed', () => {
    const app = runtime();
    const old = app.api.start(app.element);
    app.api.start(app.element);
    old.dispatchEvent(new Event('end'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'start');
    app.element.removeAttribute('speech-recognition');
    app.observers[1].callback({ target: app.element });
    app.instances[1].dispatchEvent(new Event('end'));
    assert.equal(app.element.hasAttribute('speech-recognition'), false);
});


test('query-only controls initialize on load and clicks create start, stop and end status', async () => {
    const app = runtime(true, undefined, true);
    assert.equal(app.element.hasAttribute('speech-recognition'), false);
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 1);
    assert.equal(app.element.getAttribute('speech-recognition'), 'start');
    result(app.instances[0], 'Hello');
    await flush();
    assert.equal(app.target.value, 'Hello');
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'stop');
    app.instances[0].dispatchEvent(new Event('end'));
    assert.equal(app.element.getAttribute('speech-recognition'), 'end');
});

test('Observer initializes query-only added nodes and newly added query attributes once', () => {
    for (const observerIndex of [0, 1]) {
        const app = runtime();
        const added = new Element();
        added.removeAttribute('speech-recognition');
        added.setAttribute('speech-recognition-query', '#transcript');
        app.observers[observerIndex].callback({ target: added, attributeName: 'speech-recognition-query', oldValue: null });
        app.api.init(added);
        added.dispatchEvent(new Event('click'));
        assert.equal(app.instances.length, 1);
        assert.equal(app.instances[0].stops, 0);
        assert.equal(added.getAttribute('speech-recognition'), 'start');
    }
});

test('query-only controls with actions defer the click until the action runs', async () => {
    const app = runtime(true, undefined, true);
    app.element.setAttribute('actions', 'speechRecognition');
    app.element.dispatchEvent(new Event('click'));
    assert.equal(app.instances.length, 0);
    const action = invoke(app);
    assert.equal(app.element.getAttribute('speech-recognition'), 'start');
    app.instances[0].dispatchEvent(new Event('start'));
    await action.promise;
    assert.equal(action.calls[0].type, 'end');
});
