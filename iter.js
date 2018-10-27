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
  const _T_U8ARRAY = Uint8Array[_ITERTYPE] = Symbol.for('iter:u8array');
  
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
  
  function SelfIterable(next) {
    this.next = next;
  }
  SelfIterable.prototype[_ITER] = function(){ return this; };
  
  function AsyncSelfIterable(next) {
    this.next = next;
  }
  AsyncSelfIterable.prototype.isAsync = true;
  AsyncSelfIterable.prototype[_ASYNCITER] = function(){ return this; };
  
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
  
  iter.map = function map(src, mapFunc) {
    if (_ITER in src) {
      return function*() {
        for (const el of src) yield mapFunc(el);
      };
    }
    else if (_ASYNCITER in src) {
      const asyncIter = src[_ASYNCITER]();
      const v = {
        next: async function() {
          const step = asyncIter.next();
          return step.done ? step : {done:false, value:mapFunc(step.value)};
        },
      };
      v[_ASYNCITER] = v;
      return v;
    }
    else throw new Error('iteration not found');
  };
  
  iter.filter = function filter(src, filterFunc) {
    if (_ITER in src) {
      return function*() {
        for (const el of src) if (filterFunc(el)) yield el;
      };
    }
    else if (_ASYNCITER in src) {
      const asyncIter = src[_ASYNCITER]();
      const v = {
        next: async function() {
          for (;;) {
            const step = await asyncIter.next();
            if (step.done || filterFunc(step.value)) return value;
          }
        },
      };
      v[_ASYNCITER] = v;
      return v;
    }
    else throw new Error('iteration not found');
  };
  
  iter.reduce = function reduce(src, reduceFunc, initialValue) {
    if (_ITER in src) {
      if (arguments.length > 2) {
        var currentValue = initialValue;
        for (var element of src) {
          currentValue = reduceFunc(src, currentValue);
        }
        return currentValue;
      }
      src = src[_ITER]();
      var step = src.next();
      if (step.done) throw new Error('reduce of empty iterator with no initial value');
      var currentValue = step.value;
      while (!(step = src.next()).done) {
        currentValue = reduceFunc(currentValue, step.value);
      }
      return currentValue;
    }
    if (_ASYNCITER in src) {
      src = src[_ASYNCITER]();
      if (arguments.length === 2) {
        return (async function() {
          var step = await src.next();
          if (step.done) throw new Error('reduce of empty iterator with no initial value');
          var currentValue = step.value;
          for (step = await src.next(); !step.done; step = await src.next()) {
            currentValue = reduceFunc(currentValue, step.value);
          }
          return currentValue;
        })();
      }
      return (async function() {
        var currentValue = initialValue;
        for (var step = await src.next(); !step.done; step = await src.next()) {
          currentValue = reduceFunc(currentValue, step.value);
        }
        return currentValue;
      })();
    }
    throw new Error('not a valid iterable');
  };
  
  iter.record = function record(v) {
    if (_ITER in v) {
      var values = {};
      var iterable = {values:values};
      iterable[_ITER] = function() {
        var iterator = {};
        var i = 0;
        iterator.next = function() {
          if (i < values.length) {
            return {value:values[i++], done:false};
          }
          if (values.complete) return {done:true};
          var step = v.next();
          if (step.done) {
            values.complete = true;
          }
          else {
            values.push(step.value);
            i++;
          }
          return step;
        };
        return iterator;
      };
      return iterable;
    }
    if (_ASYNCITER in v) {
      v = v[_ASYNCITER]();
      var values = [];
      var iterable = {values:values};
      iterable[_ASYNCITER] = function() {
        var iterator = {};
        var i = 0;
        iterator.next = async function() {
          if (i < values.length) {
            return Promise.resolve({value:values[i++], done:false});
          }
          if (values.complete) return Promise.resolve({done:true});
          var step = await v.next();
          if (step.done) {
            values.complete = true;
          }
          else {
            values.push(step.value);
            i++;
          }
          return step;
        };
        return iterator;
      };
      return iterable;
    }
    throw new Error('not a valid iterable');
  };
  
  const UTF8 = new TextEncoder('utf-8');
  
  iter.pipeBlobPartsToByteArrays = function pipeBlobPartsToByteArrays(iterable) {
    if (_T_BLOBPART in iterable) iterable = iterable[_T_BLOBPART];
    var pipedIterable = {};
    pipedIterable[_T_U8ARRAY] = pipedIterable;
    pipedIterable[_TYPESPECIFIED] = true;
    const symbol = (_ITER in pipedIterable) ? _ITER
                  : (_ASYNCITER in pipedIterable) ? _ASYNCITER
                  : (throw new Error('invalid iterable'));
    pipedIterable[_ASYNCITER] = function() {
      var pipedIterator = pipedIterable[symbol]();
      return {
        next: async function next() {
          var step = await pipedIterator.next();
          if (step.done || step.value instanceof Uint8Array) return step;
          if (ArrayBuffer.isView(step.value)) {
            return {done:false, value:new Uint8Array(step.value.buffer, step.value.byteLength)};
          }
          if (step.value instanceof ArrayBuffer) {
            return {done:false, value:new Uint8Array(step.value)};
          }
          if (typeof step.value === 'string') {
            return {done:false, value:UTF8.encode(step.value)};
          }
          if (step.value instanceof Blob) {
            return new Promise(function(resolve, reject) {
              const fr = new FileReader;
              fr.onload = function() {
                resolve({done:false, value:new Uint8Array(this.result)});
              };
              fr.onerror = function() {
                reject(this.error);
              };
              fr.readAsArrayBuffer(step.value);
            });
          }
          throw new Error('not a valid blob part');
        },
      };
    };
  };
  
  return iter;

});
