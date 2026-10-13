/* PyPhone Python runner — runs Pyodide in a Web Worker so the UI never freezes.
 * Loaded as a module worker: new Worker('pyrunner.js', { type: 'module' }).
 * Stopping a run = the page terminates this worker and starts a fresh one.
 *
 * Messages in  : { type:'run',  code, swReady }
 *                { type:'load', name }
 * Messages out : { type:'ready' } | { type:'fatal', error }
 *                { type:'out', text, cls }          cls: 'err' | 'info' | undefined
 *                { type:'stdin', id, prompt }        page must answer via the service worker
 *                { type:'done', ok }
 */

const PYODIDE_VERSION = '0.26.2';
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/';

let swReady = false;

function out(text, cls){ postMessage({ type: 'out', text: text, cls: cls }); }

/* Drop Pyodide's own frames from tracebacks so learners only see their code. */
function cleanTraceback(msg){
  const lines = String(msg).split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++){
    const ln = lines[i];
    if (/^  File "/.test(ln) && /[\\/]_pyodide[\\/]/.test(ln)){
      while (i + 1 < lines.length && /^    /.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(ln.replace('File "<exec>"', 'File "<script>"'));
  }
  let text = kept.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

/* input(): a worker cannot call window.prompt, so ask the page to prompt and
 * block here with a synchronous XHR that the service worker holds open until
 * the page posts the answer. Returns null when that path is unavailable. */
function readInput(promptText){
  if (!swReady) return null;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  postMessage({ type: 'stdin', id: id, prompt: String(promptText) });
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', new URL('__pyphone_stdin__?id=' + encodeURIComponent(id), self.location.href).href, false);
    xhr.send();
    if (xhr.status === 200) return xhr.responseText;
  } catch(e){}
  return null;
}

const ready = (async () => {
  const { loadPyodide } = await import(PYODIDE_BASE + 'pyodide.mjs');
  const py = await loadPyodide({ indexURL: PYODIDE_BASE });
  py.setStdout({ batched: (m) => out(m + '\n') });
  py.setStderr({ batched: (m) => out(m + '\n', 'err') });
  py.registerJsModule('pyphone_io', { read_input: readInput });
  py.runPython(
    'import builtins, pyphone_io\n' +
    'def _pyphone_input(prompt=""):\n' +
    '    prompt = str(prompt)\n' +
    '    v = pyphone_io.read_input(prompt)\n' +
    '    if v is None:\n' +
    '        raise EOFError("input() is not available right now. Reload the page once, then try again.")\n' +
    '    v = str(v)\n' +
    '    print(prompt + v)\n' +
    '    return v\n' +
    'builtins.input = _pyphone_input\n'
  );
  postMessage({ type: 'ready' });
  return py;
})();
ready.catch((err) => {
  postMessage({ type: 'fatal', error: String((err && err.message) || err) });
});

function flushStreams(py){
  try { py.runPython('import sys\nsys.stdout.flush()\nsys.stderr.flush()'); } catch(e){}
}

async function runUserCode(py, code){
  let globals = null;
  try {
    /* Pyodide does not auto-load packages: fetch whatever the code imports. */
    await py.loadPackagesFromImports(code, {
      messageCallback: (m) => out(m + '\n', 'info'),
      errorCallback: (m) => out(m + '\n', 'err'),
    });
    /* Fresh namespace per run: no variables left over from earlier runs or tabs. */
    globals = py.runPython('dict()');
    globals.set('__name__', '__main__');
    await py.runPythonAsync(code, { globals: globals });
    flushStreams(py);
    postMessage({ type: 'done', ok: true });
  } catch (err){
    flushStreams(py);
    out(cleanTraceback((err && err.message) ? err.message : String(err)), 'err');
    postMessage({ type: 'done', ok: false });
  } finally {
    if (globals) { try { globals.destroy(); } catch(e){} }
  }
}

async function loadPackageByName(py, name){
  try {
    await py.loadPackage(name, {
      messageCallback: (m) => out(m + '\n', 'info'),
      errorCallback: (m) => out(m + '\n', 'err'),
    });
    out(name + ' loaded. You can now `import ' + name + '`.\n', 'info');
    postMessage({ type: 'done', ok: true });
  } catch (err){
    out('Failed to load ' + name + ': ' + String((err && err.message) || err) + '\n', 'err');
    postMessage({ type: 'done', ok: false });
  }
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  let py;
  try { py = await ready; }
  catch (err){ postMessage({ type: 'done', ok: false }); return; }

  if (msg.type === 'run'){
    swReady = !!msg.swReady;
    await runUserCode(py, String(msg.code || ''));
  } else if (msg.type === 'load'){
    await loadPackageByName(py, String(msg.name || ''));
  }
};
