define([
  'iter'
  ,'omar'
],
function(
  iter
  ,omar
){

  'use strict';
  
  function Tokenator() {
  }
  Tokenator.prototype = {
    comment: function(rx) {
      return this;
    },
    whitespace: function(rx) {
      return this;
    },
    identifier: function(rx) {
    },
  };
  
  return Object.assign(Tokenator, {
    C_STYLE_COMMENT: /\/\*[^]*?\*\//,
    CPP_STYLE_COMMENT: /\/\/.*/,
    ASCII_WHITESPACE: /[ \r\n\t]/,
    C_STYLE_IDENTIFIER: /[a-zA-Z_][a-zA-Z0-9_]*/,
  });

});
