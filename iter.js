define(function(){

  'use strict';
  
  const _ITER = Symbol.iterator;
  const _ASYNCITER = Symbol.asyncIterator || Symbol.for('asyncIterator');
  const _ITERTYPE = Symbol('iterTypeSymbol');
  const _TYPESPECIFIED = Symbol('typeSpecified');
  
  const PROP_SELF = {get:function(){return this}, configurable:true};
  
  String[_ITERTYPE] = Symbol.for('iter:string');
  
  function WrappedAsyncIterator(wrapMe) {
    this.next = wrapMe.next.bind(wrapMe);
    if ('return' in wrapMe) {
      this.return = wrapMe.return.bind(wrapMe);
    }
  }
  WrappedAsyncIterator.prototype = {
    isAsync: true,
  };
  
  function getElementTypeSymbol(elementType) {
    switch (typeof elementType) {
      case 'string':
        return Symbol.for('iter:' + elementType);
      case 'symbol': return elementType;
      case 'object':
        if (_ITERTYPE in elementType) {
          return elementType[_ITERTYPE];
        }
        return elementType[_ITERTYPE] = new Symbol();
      default:
        throw new Error('invalid type specifier');
    }
  }
  
  function iter(v, elementType) {
    if (elementType) {
      elementType = getElementTypeSymbol(elementType);
      if (elementType in v) {
        v = v[elementType];
      }
      else if (_TYPESPECIFIED in v) {
        throw new Error('typed iteration not found');
      }
    }
    if (_ITER in v) return v[_ITER]();
    if (_ASYNCITER in v) {
      const asyncIterator = v[_ASYNCITER]();
      if (!('isAsync' in asyncIterator)) {
        if (Object.isSealed(asyncIterator)) {
          return new WrappedAsyncIterator(asyncIterator);
        }
        asyncIterator.isAsync = true;
      }
      return asyncIterator;
    }
    throw new Error('iteration not found');
  }
  
  iter.initType = function initType(v, elementType, asThis) {
    v[_TYPESPECIFIED] = true;
    elementType = getElementTypeSymbol(elementType);
    if (arguments.length === 2) {
      Object.defineProperty(v, elementType, PROP_SELF);
      return;
    }
    if (typeof asThis === 'function') {
      Object.defineProperty(v, elementType, {get:asThis, configurable:true});
      return;
    }
    v[elementType] = asThis;
  };
  
  iter.WrappedAsyncIterator = WrappedAsyncIterator;
  
  iter.makeString = function(v) {
    if (typeof v === 'string') return v;
    if (_ITER in v) {
      return [...v].join('');
    }
    if (_ASYNCITER in v) {
      return (async function() {
        const list = [];
        const asyncIterator = v[_ASYNCITER]();
        for (;;) {
          var iteration = await asyncIterator.next();
          if (iteration.done) break;
          list.push(iteration.value);
        }
        return list.join('');
      })();
    }
    return v.toString();
  };
  
  iter.makeBlob = function(v) {
    if (_ITER in v) {
      return new Blob([...v]);
    }
    if (_ASYNCITER in v) {
      return (async function() {
        const list = [];
        const asyncIterator = v[_ASYNCITER]();
        for (;;) {
          var iteration = await asyncIterator.next();
          if (iteration.done) break;
          list.push(iteration.value);
        }
        return new Blob(list);
      })();
    }
    throw new Error('blob source not found');
  };
  
  return iter;

});
