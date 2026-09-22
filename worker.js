/* PyPhone highlight worker — tokenizes Python off the main thread */

const HTML_ESCAPES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function esc(s){
  return String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

const TOKEN_RE = new RegExp(
  '(?<comment>#[^\\n]*)' +
  '|(?<string>"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')' +
  '|(?<decorator>@[A-Za-z_]\\w*)' +
  '|(?<number>\\b(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?))' +
  '|(?<word>[A-Za-z_]\\w*)' +
  '|(?<op>[+\\-*/%=<>!&|^~]+)' +
  '|(?<punct>[(){}\\[\\],.:;])',
  'g'
);

const KW_BLUE = new Set(['def','class','lambda','global','nonlocal','del','assert',
  'pass','async','await','and','or','not','in','is','True','False','None','self','cls']);
const KW_PURPLE = new Set(['if','elif','else','for','while','return','break',
  'continue','try','except','finally','with','as','raise','yield','import','from']);
const BUILTINS = new Set(['abs','all','any','ascii','bin','bool','bytearray',
  'bytes','callable','chr','classmethod','compile','complex','delattr','dict',
  'dir','divmod','enumerate','eval','exec','filter','float','format','frozenset',
  'getattr','globals','hasattr','hash','help','hex','id','input','int','isinstance',
  'issubclass','iter','len','list','locals','map','max','min','next','object','oct',
  'open','ord','pow','print','property','range','repr','reversed','round','set',
  'setattr','slice','sorted','staticmethod','str','sum','super','tuple','type',
  'vars','zip','Exception','ValueError','TypeError','KeyError','IndexError',
  'RuntimeError','StopIteration','ZeroDivisionError','NameError','AttributeError',
  'ImportError','FileNotFoundError','OSError','IOError','ArithmeticError',
  'LookupError','AssertionError','NotImplementedError','BaseException']);

function highlightPython(code){
  const tokens = [];
  let last = 0, m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(code)) !== null){
    if (m.index > last) tokens.push({ t:'plain', v: code.slice(last, m.index) });
    const g = m.groups;
    let kind = 'plain';
    if (g.comment !== undefined) kind = 'comment';
    else if (g.string !== undefined) kind = 'string';
    else if (g.decorator !== undefined) kind = 'decorator';
    else if (g.number !== undefined) kind = 'number';
    else if (g.word !== undefined) kind = 'word';
    else if (g.op !== undefined) kind = 'op';
    else if (g.punct !== undefined) kind = 'punct';
    tokens.push({ t: kind, v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < code.length) tokens.push({ t:'plain', v: code.slice(last) });

  let html = '', prevWord = '';
  for (let i = 0; i < tokens.length; i++){
    const tk = tokens[i];
    if (tk.t === 'word'){
      let j = i + 1;
      while (j < tokens.length && tokens[j].t === 'plain') j++;
      const nx = tokens[j];
      const isCall = nx && nx.v.charAt(0) === '(';
      let cls;
      if (prevWord === 'def') cls = 'fn';
      else if (prevWord === 'class') cls = 'cls';
      else if (KW_BLUE.has(tk.v)) cls = 'kw';
      else if (KW_PURPLE.has(tk.v)) cls = 'cf';
      else if (BUILTINS.has(tk.v)) cls = 'bi';
      else if (isCall) cls = 'fn';
      else cls = 'var';
      html += '<span class="' + cls + '">' + esc(tk.v) + '</span>';
      prevWord = tk.v;
    }
    else if (tk.t === 'comment')   html += '<span class="com">' + esc(tk.v) + '</span>';
    else if (tk.t === 'string')    html += '<span class="str">' + esc(tk.v) + '</span>';
    else if (tk.t === 'number')    html += '<span class="num">' + esc(tk.v) + '</span>';
    else if (tk.t === 'decorator') html += '<span class="dec">' + esc(tk.v) + '</span>';
    else if (tk.t === 'op')        html += '<span class="op">'  + esc(tk.v) + '</span>';
    else                           html += esc(tk.v);
  }
  return html;
}

self.onmessage = function(e){
  const { id, code } = e.data;
  try {
    const html = highlightPython(code);
    self.postMessage({ id, html, ok: true });
  } catch(err){
    self.postMessage({ id, html: '', ok: false, error: String(err) });
  }
};
