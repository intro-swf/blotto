define(function(){

  'use strict';
  
  const _ITER = Symbol.iterator;
  const _ASYNCITER = Symbol.asyncIterator || Symbol.for('asyncIterator');
  const _ITERTYPE = Symbol('iterTypeSymbol');
  const _TYPESPECIFIED = Symbol('typeSpecified');
  
  const PROP_SELF = {get:function(){return this}, configurable:true};
  const PROP_SINGLETON_ITER = {
    get: function() {
      const v = this;
      return function*() {
        yield v;
      };
    },
    configurable: true,
  };
  
  const _T_STRING = String[_ITERTYPE] = Symbol.for('iter:string');
  const _T_BLOBPART = Symbol.for('iter:blobPart');
  
  Object.defineProperty(String.prototype, _T_BLOBPART, PROP_SINGLETON_ITER);
  Object.defineProperty(Blob.prototype, _T_BLOBPART, PROP_SINGLETON_ITER);
  Object.defineProperty(ArrayBuffer.prototype, _T_BLOBPART, PROP_SINGLETON_ITER);
  Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype), _T_BLOBPART, PROP_SINGLETON_ITER);
  
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
  
  iter.makeArray = function(v, elementType) {
    if (elementType) {
      elementType = getElementTypeSymbol(elementType);
      if (elementType in v) {
        v = v[elementType];
      }
      else if (_TYPESPECIFIED in v) {
        throw new Error('type not found');
      }
    }
    if (_ITER in v) {
      return [...v];
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
        return list;
      })();
    }
    throw new Error('value not iterable');
  };
  
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
    v = iter.makeArray(v, _T_BLOBPART);
    if (v instanceof Promise) {
      return v.then(function(v) {
        return new Blob(v);
      });
    }
    return new Blob(v);
  };
  
  function AsyncQueueIterable(elementType) {
    if (elementType) {
      elementType = getElementTypeSymbol(elementType);
      this[elementType] = this;
      this[_TYPESPECIFIED] = true;
    }
  }
  AsyncQueueIterable.prototype = {
    nextGet: null,
    lastGet: null,
    nextSet: null,
    lastSet: null,
    next: function() {
      const nextGet = this.nextGet;
      if (nextGet) {
        if (nextGet.nextGet) {
          this.nextGet = nextGet.nextGet;
        }
        else {
          delete this.nextGet;
          delete this.lastGet;
        }
        return nextGet;
      }
      const self = this;
      return new Promise(function(resolve, reject) {
        resolve.reject = reject;
        if (self.nextSet) {
          self.lastSet.nextSet = resolve;
          self.lastSet = resolve;
        }
        else {
          self.nextSet = self.lastSet = resolve;
        }
      });
    },
    append: function(el) {
      const nextSet = this.nextSet;
      if (nextSet) {
        this.nextSet = nextSet.nextSet;
        nextSet({value:el, done:false});
      }
      else {
        const promise = Promise.resolve({value:el, done:false});
        const nextGet = this.nextGet;
        if (nextGet) {
          this.lastGet.nextGet = promise;
          this.lastGet = promise;
        }
        else {
          this.nextGet = this.lastGet = promise;
        }
      }
      return this;
    },
    complete: function() {
      const nextSet = this.nextSet;
      if (nextSet) {
        this.nextSet = nextSet.nextSet;
        nextSet({done:true});
      }
      else {
        const promise = Promise.resolve({done:true});
        promise.nextGet = promise;
        const nextGet = this.nextGet;
        if (nextGet) {
          this.lastGet.nextGet = promise;
          this.lastGet = promise;
        }
        else {
          this.nextGet = this.lastGet = promise;
        }
      }
      return this;
    },
    appendError: function(message) {
      const nextSet = this.nextSet;
      if (nextSet) {
        this.nextSet = nextSet.nextSet;
        nextSet.reject(message);
      }
      else {
        const promise = Promise.reject(message);
        promise.nextGet = promise;
        const nextGet = this.nextGet;
        if (nextGet) {
          this.lastGet.nextGet = promise;
          this.lastGet = promise;
        }
        else {
          this.nextGet = this.lastGet = promise;
        }
      }
      return this;
    },
  };
  AsyncQueueIterable.prototype[_ASYNCITER] = function() {
    return this;
  };
  iter.AsyncQueue = AsyncQueueIterable;
  
  return iter;

});
