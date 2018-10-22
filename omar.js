define(function() {

  'use strict';
  
  /* OMAR: Object Model API for Regex */

  function escape(str) {
    return str.replace(/[\.\*\+\?\^\$\{\}\(\)\|\[\]\\]/g, '\\$&');
  }
  
  function OmarObject() {
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
        return '(?OMAR)'; // invalid
      },
    },
    toRegExp: {
      value: function(flags) {
        return new RegExp(this.toString(), flags);
      },
      configurable: true,
    },
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
  });
  
  function OmarSequence(iter) {
    for (var obj of iter) {
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
  });
  OmarSequence.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
  OmarSequence.EMPTY = new OmarSequence([]);
  
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
    /\\(?:[^cxu]|c[a-zA-Z]|x[0-9a-fA-F]{2}|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{4,5}\}))/,
  ].map(function(rx){ return rx.source; }).join('|'), 'g');
  
  const PAT_REP = /[\?\*\+\{/;
  
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
    var parts = [], startIndex = 0;
    PAT_PART.lastIndex = 0;
    for (var match = PAT_PART.exec(pattern); startIndex < pattern.length; match = PAT_PART.exec(pattern)) {
      if (!match || match.index !== startIndex) {
        throw new Error('unrecognized content in pattern');
      }
      startIndex = PAT_PART.lastIndex;
      if (match[1]) {
        // literal
        if (PAT_REP.test(pattern[startIndex])) {
          if (match[1].length > 1) {
            parts.push(new OmarLiteral(match[1].slice(0, -1)));
          }
          var rep = PAT_PART.exec(pattern);
          if (!rep || rep.index !== startIndex) {
            throw new Error('unrecognized content in pattern');
          }
          startIndex = PAT_PART.lastIndex;
          var finalChar = new OmarLiteral(match[1].slice(-1));
          switch (rep[0][0]) {
            case '*':
              parts.push(new OmarRepeat(finalChar, 0, Infinity, rep[0] !== '*?');
              break;
            case '+':
              parts.push(new OmarRepeat(finalChar, 1, Infinity, rep[0] !== '*?');
              break;
            case '?':
              parts.push(new OmarRepeat(finalChar, 0, 1, rep[0] !== '??');
              break;
            default:
              parts.push(new OmarRepeat(finalChar, +rep[2], isNaN(rep[3]) ? Infinity : +rep[3], rep[0].slice(-1) !== '?');
          }
        }
        else {
          parts.push(new OmarLiteral(match[1]));
        }
        continue;
      }
      
    }
    switch (pattern.length) {
      case 0: return OmarSequence.EMPTY;
      case 1: return parts[1];
      case 2: return new OmarSequence(parts);
    }
  }
  
  return Object.assign(omar, {
    escape: escape,
    Object: OmarObject,
    Literal: OmarLiteral,
  });

});
