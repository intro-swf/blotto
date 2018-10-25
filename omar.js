define(function() {

  'use strict';
  
  /* OMAR: Object Model API for Regex */

  function escape(str) {
    return str.replace(/[\.\*\+\?\^\$\{\}\(\)\|\[\]\\]/g, "\\$&");
  }

  function escapeSet(str) {
    return str.replace(/[\[\]\^\-\\]/g, "\\$&");
  }
  
  function OmarObject() {
    throw new Error('OmarObject cannot be directly constructed');
  }
  OmarObject.prototype = Object.create(Object.prototype, {
    minLength: {
      value: NaN,
      configurable: true,
    },
    maxLength: {
      value: NaN,
      configurable: true,
    },
    fixedLength: {
      get: function() {
        const min = this.minLength, max = this.maxLength;
        if (min === max) return min;
        return NaN;
      },
      configurable: true,
    },
    toString: {
      value: function() {
        return '(??INVALID)'; // invalid
      },
    },
    toAtom: {
      value: function() {
        return this.toString();
      },
    },
    toRegExp: {
      value: function(flags) {
        return new RegExp(this.toString(), flags);
      },
      configurable: true,
    },
  });
  
  function OmarSequence(iter) {
    for (var obj of iter) {
      if (!(obj instanceof OmarObject)) throw new Error('invalid element');
      this[this.length++] = obj;
    }
    Object.freeze(this);
  }
  OmarSequence.prototype = Object.create(OmarObject.prototype, {
    length: {
      value: 0,
      writable: true,
    },
    minLength: {
      get: function() {
        var min = 0;
        for (var i = this.length-1; i >= 0; i--) {
          min += this[i].minLength;
        }
        return min;
      },
    },
    maxLength: {
      get: function() {
        var max = 0;
        for (var i = this.length-1; i >= 0; i--) {
          max += this[i].maxLength;
        }
        return max;
      },
    },
    type: {value:'sequence'},
    toString: {
      value: function() {
        return Array.prototype.join.call(this, '');
      },
    },
    toAtom: {
      value: function() {
        return this.length === 1 ? this[0].toAtom() : '(?:' + this.toString() + ')';
      },
    },
  });
  OmarSequence.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
  OmarSequence.EMPTY = new OmarSequence([]);
  
  function OmarChoice(iter) {
    for (var obj of iter) {
      if (!(obj instanceof OmarObject)) throw new Error('invalid choice');
      this[this.length++] = obj;
    }
    if (this.length < 2) throw new Error('at least 2 choices');
    Object.freeze(this);
  }
  OmarChoice.prototype = Object.create(OmarObject.prototype, {
    minLength: {
      get: function() {
        var minLength = Infinity;
        for (var i = 0; i < this.length; i++) {
          minLength = Math.min(minLength, this[i].minLength);
          if (minLength === 0) break;
        }
        return minLength;
      },
    },
    maxLength: {
      get: function() {
        var maxLength = 0;
        for (var i = 0; i < this.length; i++) {
          maxLength = Math.max(maxLength, this[i].maxLength);
          if (!isFinite(maxLength)) break;
        }
        return maxLength;
      },
    },
    toString: {
      value: function() {
        return Array.prototype.join.call(this, '|');
      },
    },
    toAtom: {
      value: function() {
        return this.length === 1 ? this[0].toAtom() : '(?:' + this.toString() + ')';
      },
    },
    type: {value:'choice'},
  });
  OmarChoice.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
  
  function OmarRepeat(omo, minCount, maxCount, greedy) {
    if (!(omo instanceof OmarObject)) throw new Error('not a valid omar object');
    if (isNaN(minCount) || minCount < 0 || minCount !== Math.floor(minCount) || !isFinite(minCount)) {
      throw new Error('invalid minCount');
    }
    if (isNaN(maxCount) || maxCount < minCount || maxCount === 0 || maxCount !== Math.floor(maxCount)) {
      throw new Error('invalid maxCount');
    }
    this.repeatObject = omo;
    this.minCount = minCount;
    this.maxCount = maxCount;
    this.greedy = greedy;
    Object.freeze(this);
  }
  OmarRepeat.prototype = Object.create(OmarObject.prototype, {
    minLength: {
      get: function() {
        return this.repeatObject.minLength * this.minCount;
      },
    },
    maxLength: {
      get: function() {
        return this.repeatObject.maxLength * this.maxCount;
      },
    },
    toString: {
      value: function() {
        var str = this.repeatObject.toAtom();
        var mod;
        switch (this.minCount) {
          case 0:
            switch (this.maxCount) {
              case 1: mod = '?'; break;
              case Infinity: mod = '*'; break;
              default:
                mod = '{0,' + this.maxCount + '}';
                break;
            }
            break;
          case 1:
            if (this.maxCount === Infinity) {
              mod = '+';
            }
            else {
              mod = '{1,' + this.maxCount + '}';
            }
            break;
          default:
            mod = '{'+this.minCount+','+this.maxCount+'}';
            break;
        }
        return this.greedy ? str+mod : str+mod+'?';
      },
    },
    type: {value:'repeat'},
  });
  
  function OmarCharSet(chars) {
    if (typeof chars !== 'string') {
      throw new Error('invalid char set');
    }
    this.chars = chars;
  }
  OmarCharSet.prototype = Object.create(OmarObject.prototype, {
    minLength: {
      value: 1,
    },
    maxLength: {
      value: 1,
    },
    fixedLength: {
      value: 1,
    },
    inSetString: {
      get: function() {
        return escapeSet(this.chars);
      },
    },
    toString: {
      value: function() {
        var str = this.inSetString;
        if (str === null) return '(??INVALID_SET)';
        return '[' + str + ']';
      },
    },
    type: {value:'charset'},
  });
  
  function OmarCharSetUnion(iter) {
    this.length = 0;
    for (var charset of iter) {
      if (!(charset instanceof OmarCharSet)) {
        throw new Error('not a charset object');
      }
      this[this.length++] = charset;
    }
    Object.freeze(this);
  }
  OmarCharSetUnion.prototype = Object.create(OmarCharSet.prototype, {
    inSetString: {
      get: function() {
        var arr = new Array(this.length);
        for (var i = 0; i < arr.length; i++) {
          var str = this[i].inSetString;
          if (str === null) return null;
          arr[i] = str;
        }
        return arr.join('');
      },
    },
  });
  OmarCharSetUnion.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
  
  function OmarCharSetNegated(charset) {
    this.charset = charset;
    Object.freeze(this);
  }
  OmarCharSetNegated.prototype = Object.create(OmarCharSet.prototype, {
    inSetString: {value:null},
    toString: {
      value: function() {
        var str = this.charset.inSetString;
        if (str === null) return '(??INVALID_SET)';
        return '[^' + str + ']';
      },
    },
  });
  
  function OmarCharRange(fromChar, toChar) {
    this.fromChar = fromChar;
    this.toChar = toChar;
  }
  OmarCharRange.prototype = Object.create(OmarCharSet.prototype, {
    inSetString: {
      get: function() {
        return escapeSet(this.fromChar) + '-' + escapeSet(this.toChar);
      },
    },
  });
  
  function OmarCharSetRef(ref, charset, notInSet) {
    this.ref = ref;
    this.charset = charset;
    if (notInSet) {
      Object.defineProperty(this, 'inSetString', {
        value: null,
      });
    }
    Object.freeze(this);
  }
  OmarCharSetRef.prototype = Object.create(OmarCharSet.prototype, {
    inSetString: {
      get: function() {
        return this.ref;
      },
    },
    toString: {
      value: function() {
        return this.ref;
      },
    },
  });
  
  OmarCharSet.DOT = new OmarCharSetRef('.', new OmarCharSetNegated(new OmarCharSet('\r\n\u2028\u2029')), true);
  [
    ['s', new OmarCharSetUnion([
      new OmarCharSet(' \f\n\r\t\v\u00a0\u1680'),
      new OmarCharRange('\u2000','\u200a'),
      new OmarCharSet('\u2028\u2029\u202f\u205f\u3000\ufeff'),
    ])],
    ['d', new OmarCharRange('0','9')],
    ['w', new OmarCharSetUnion([
      new OmarCharRange('0','9'),
      new OmarCharRange('A','Z'),
      new OmarCharRange('a','z'),
      new OmarCharSet('_'),
    ])],
  ].forEach(function(v) {
    OmarCharSet[v[0]] = new OmarCharSetRef('\\'+v[0], v[1]);
    OmarCharSet[v[0].toUpperCase()] = new OmarCharSetRef('\\'+v[0].toUpperCase(), new OmarCharSetNegated(v[1]));
  });
  
  function OmarLiteral(literal) {
    if (typeof literal !== 'string') throw new Error('literal must be string');
    if (literal.length === 0) throw new Error('literal must be at least one character');
    this.literal = literal;
    Object.freeze(this);
  }
  OmarLiteral.prototype = Object.create(OmarObject.prototype, {
    minLength: {get:function(){ return this.literal.length; }},
    maxLength: {get:function(){ return this.literal.length; }},
    fixedLength: {get:function(){ return this.literal.length; }},
    toString: {
      value: function() {
        return escape(this.literal);
      },
    },
    toAtom: {
      value: function() {
        return this.literal.length === 1 ? this.literal : '(?:' + this.literal + ')';
      },
    },
    type: {value:'literal'},
  });
  
  function OmarCheck() {
  }
  OmarCheck.prototype = Object.create(OmarObject.prototype, {
    minLength: {
      value: 0,
    },
    maxLength: {
      value: 0,
    },
    fixedLength: {
      value: 0,
    },
    type: {value:'check'},
  });
  
  OmarCheck.LEFT_ANCHOR = Object.create(OmarObject.prototype, {
    toString: {
      value: function() {
        return '^';
      },
    },
    checkType: {value:'leftAnchor'},
  });
  
  OmarCheck.RIGHT_ANCHOR = Object.create(OmarObject.prototype, {
    toString: {
      value: function() {
        return '$';
      },
    },
    checkType: {value:'rightAnchor'},
  });
  
  OmarCheck.WORD_BOUNDARY = Object.create(OmarObject.prototype, {
    toString: {
      value: function() {
        return '\\b';
      },
    },
    checkType: {value:'wordBoundary'},
    negated: {value:false},
  });
  
  OmarCheck.WORD_BOUNDARY.NEGATED = Object.create(OmarObject.prototype, {
    toString: {
      value: function() {
        return '\\B';
      },
    },
    negated: {value:true},
  });
  
  function OmarLook(type, omo) {
    this.type = type;
    this.omo = omo;
  }
  OmarLook.prototype = Object.create(OmarCheck.prototype, {
    toString: {
      value: function() {
        return '(' + this.type + this.omo + ')';
      },
    },
  });
  OmarLook.AHEAD = '=';
  OmarLook.AHEAD_NEGATED = '!';
  OmarLook.BEHIND = '<=';
  OmarLook.BEHIND_NEGATED = '<!';
  
  function OmarBackReference(number) {
    this.number = number;
    Object.freeze(this);
  }
  OmarBackReference.prototype = Object.create(OmarObject.prototype, {
    toString: {
      value: function() {
        return '\\'+this.number;
      },
    },
  });
  
  const PAT_PART = new RegExp([
  /* literal - check !!match[1] */
    /([^\^\$\.\\\[\(\)\?\*\+\{\|]+)/,
  /* single characters */
    /[\.\|\)\^\$]/,
  /* count modifiers - match[2] min, match[3] max */
    /(?:[\+\*\?]|\{(\d+)(?:,(\d*))?\})\??/,
  /* group */
    /\((?:\?[:!=]|(?!\?))?/,
  /* start of a set */
    /\[\^?/,
  /* backslash escape */
    /\\(?:[^cxu]|c[a-zA-Z]|x[0-9a-fA-F]{2}|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})|\d+)/,
  ].map(function(rx){ return rx.source; }).join('|'), 'gy');
  
  const PAT_REP = /[\?\*\+\{]/;
  
  const PAT_CHARSET_BACKSLASHED = /x[0-9a-fA-F]{2}|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})|c[a-zA-Z]|0|[^xuc\d]/gy;
  
  function omar(pattern) {
    if (pattern instanceof OmarObject) {
      return pattern;
    }
    else if (pattern instanceof RegExp) {
      pattern = pattern.source;
    }
    else if (typeof pattern !== 'string') {
      throw new Error('pattern must be a string');
    }
    var parts = [];
    PAT_PART.lastIndex = 0;
    while (PAT_PART.lastIndex < pattern.length) {
      var match = PAT_PART.exec(pattern);
      if (!match) {
        throw new Error('unrecognized content in pattern');
      }
      if (match[1]) {
        // literal
        if (PAT_REP.test(pattern[PAT_PART.lastIndex])) {
          if (match[1].length > 1) {
            parts.push(new OmarLiteral(match[1].slice(0, -1)));
          }
          var rep = PAT_PART.exec(pattern);
          if (!rep) {
            throw new Error('unrecognized content in pattern');
          }
          var finalChar = new OmarLiteral(match[1].slice(-1));
          switch (rep[0][0]) {
            case '*':
              parts.push(new OmarRepeat(finalChar, 0, Infinity, rep[0] !== '*?'));
              break;
            case '+':
              parts.push(new OmarRepeat(finalChar, 1, Infinity, rep[0] !== '+?'));
              break;
            case '?':
              parts.push(new OmarRepeat(finalChar, 0, 1, rep[0] !== '??'));
              break;
            default:
              parts.push(new OmarRepeat(finalChar, +rep[2], isNaN(rep[3]) ? Infinity : +rep[3], rep[0].slice(-1) !== '?'));
              break;
          }
        }
        else {
          parts.push(new OmarLiteral(match[0]));
        }
        continue;
      }
      switch (match[0][0]) {
        case '.':
          parts.push(OmarCharSet.DOT);
          continue;
        case '|':
          continue;
        case '^':
          parts.push(OmarCheck.LEFT_ANCHOR);
          continue;
        case '$':
          parts.push(OmarCheck.RIGHT_ANCHOR);
          continue;
        case ')':
          if (!parts.parent) throw new Error('mismatched parentheses');
          parts = parts.parent;
          continue;
        case '*':
          if (parts.length === 0) throw new Error('invalid pattern');
          parts.push(new OmarRepeat(parts.pop(), 0, Infinity, match[0] !== '*?'));
          continue;
        case '+':
          if (parts.length === 0) throw new Error('invalid pattern');
          parts.push(new OmarRepeat(parts.pop(), 1, Infinity, match[0] !== '+?'));
          continue;
        case '?':
          if (parts.length === 0) throw new Error('invalid pattern');
          parts.push(new OmarRepeat(parts.pop(), 0, 1, match[0] !== '??'));
          continue;
        case '{':
          if (parts.length === 0) throw new Error('invalid pattern');
          parts.push(new OmarRepeat(parts.pop(), +match[2], isNaN(match[3]) ? Infinity : +match[3], match[0].slice(-1) !== '?'));
          continue;
        case '[':
          var negated = match[0] === '[^';
          var unionList = [];
          var i = PAT_PART.lastIndex;
          function readEscape() {
            PAT_CHARSET_BACKSLASHED.lastIndex = i+1;
            var match = PAT_CHARSET_BACKSLASHED.exec(pattern);
            if (!match) throw new Error('invalid escape');
            i = PAT_CHARSET_BACKSLASHED.lastIndex;
            switch (match[0]) {
              case 's': case 'S':
              case 'w': case 'W':
              case 'd': case 'D':
                return OmarCharSet[match[0]];
              case '0': return '\0';
              case 'r': return '\r';
              case 't': return '\t';
              case 'b': return '\b';
              case 'v': return '\v';
              case 'x':
                return String.fromCharCode(parseInt(match[0].slice(1)));
              default: return match[0];
            }
          }
          setLoop: for (;;) {
            var character;
            switch (pattern[i]) {
              case ']':
                PAT_PART.lastIndex = i+1;
                break setLoop;
              case '\\':
                character = readEscape();
                if (typeof character !== 'string') {
                  unionList.push(character);
                  continue setLoop;
                }
                break;
              case undefined:
                throw new Error('unterminated set');
              default:
                character = pattern[i++];
                break;
            }
            if (pattern[i] !== '-' || pattern[i+1] === ']') {
              unionList.push(character);
              continue setLoop;
            }
            var rangeEnd;
            switch (rangeEnd = pattern[++i]) {
              case undefined:
                throw new Error('unterminated set');
              case '\\':
                rangeEnd = readEscape();
                if (typeof rangeEnd !== 'string') {
                  unionList.push(character, '-', rangeEnd);
                  continue setLoop;
                }
                break;
            }
            unionList.push(new OmarCharRange(character, rangeEnd));
            i++;
          }
          for (var i = 0; i < unionList.length; i++) {
            if (typeof unionList[i] !== 'string') continue;
            var j = i;
            do { j++; } while (typeof unionList[j] === 'string');
            if (j === i+1) {
              unionList[i] = new OmarCharSet(unionList[i]);
            }
            else {
              unionList.splice(i, 0, new OmarCharSet(unionList.splice(i, j-i).join('')));
            }
          }
          var set = unionList.length === 1 ? unionList[0] : new OmarCharSetUnion(unionList);
          if (negated) {
            set = new OmarCharSetNegated(set);
          }
          parts.push(set);
          continue;
        case '\\':
          var addLiteral;
          switch(match[0][1]) {
            case 'w': case 'W':
            case 's': case 'S':
            case 'd': case 'D':
              parts.push(OmarCharSet[match[0][1]]);
              continue;
            case '1': case '2': case '3': case '4':
            case '5': case '6': case '7': case '8':
            case '9':
              parts.push(new OmarBackReference(+match[0].slice(1)));
              continue;
            case 'b':
              parts.push(OmarCheck.WORD_BOUNDARY);
              continue;
            case 'B':
              parts.push(OmarCheck.WORD_BOUNDARY.NEGATED);
              continue;
            case '0':
              if (match[0] !== '\\0') throw new Error('invalid escape');
              addLiteral = '\0';
              break;
            case 'n':
              addLiteral = '\n';
              break;
            case 'r':
              addLiteral = '\r';
              break;
            case 't':
              addLiteral = '\t';
              break;
            case 'v':
              addLiteral = '\v';
              break;
            case 'f':
              addLiteral = '\f';
              continue;
            case 'c':
              addLiteral = String.fromCharCode(match[0][2].toUpperCase().charCodeAt(0) - 65 + 1);
              break;
            case 'x':
              addLiteral = String.fromCharCode(parseInt(match[0].slice(2), 16));
              break;
            case 'u':
              if (match[0][2] === '{') {
                addLiteral = String.fromCodePoint(parseInt(match[0].slice(3, -1), 16));
              }
              else {
                addLiteral = String.fromCharCode(parseInt(match[0].slice(2), 16));
              }
              break;
            default:
              addLiteral = new OmarLiteral(match[0][1]);
              break;
          }
          if (PAT_REP.test(pattern[PAT_PART.lastIndex])) {
            var rep = PAT_PART.exec(pattern);
            if (!rep) {
              throw new Error('unrecognized content in pattern');
            }
            addLiteral = new OmarLiteral(addLiteral);
            switch (rep[0][0]) {
              case '*':
                parts.push(new OmarRepeat(addLiteral, 0, Infinity, rep[0] !== '*?'));
                break;
              case '+':
                parts.push(new OmarRepeat(addLiteral, 1, Infinity, rep[0] !== '+?'));
                break;
              case '?':
                parts.push(new OmarRepeat(addLiteral, 0, 1, rep[0] !== '??'));
                break;
              default:
                parts.push(new OmarRepeat(addLiteral, +rep[2], isNaN(rep[3]) ? Infinity : +rep[3], rep[0].slice(-1) !== '?'));
                break;
            }
            continue;
          }
          else if (parts[parts.length-1] instanceof OmarLiteral) {
            parts[parts.length-1] = new OmarLiteral(parts[parts.length-1].literal + addLiteral);
          }
          else {
            parts.push(new OmarLiteral(addLiteral));
          }
          continue;
      }
    }
    if (parts.parent) throw new Error('mismatched parentheses');
    switch (parts.length) {
      case 0: return OmarSequence.EMPTY;
      case 1: return parts[0];
      default: return new OmarSequence(parts);
    }
  }
  
  return Object.assign(omar, {
    escape: escape,
    Object: OmarObject,
    Sequence: OmarSequence,
    Choice: OmarChoice,
    Repeat: OmarRepeat,
    CharSet: OmarCharSet,
    Literal: OmarLiteral,
    Check: OmarCheck,
    Look: OmarLook,
  });

});
