var request = require('request')
, url = require('url')

module.exports = CouchLogin

function CouchLogin (couch) {
  if (!(this instanceof CouchLogin)) {
    return new CouchLogin(couch)
  }

  if (!couch) throw new Error(
    "Need to pass a couch url to CouchLogin constructor")

  // having auth completely defeats the purpose
  couch = url.parse(couch)
  delete couch.auth

  this.couch = url.format(couch)
}

CouchLogin.prototype =
{ get: makeReq('get')
, del: makeReq('del')
, put: makeReq('put', true)
, post: makeReq('post', true)
, login: login
, logout: logout
}

function makeReq (meth, body, f) { return function (p, d, cb) {
  if (!body) cb = d, d = null


  if (!f && !valid(this.token)) {
    return process.nextTick(function () {
      cb(new Error('auth token expired or invalid'))
    })
  }

  var h = {}
  , u = url.resolve(this.couch, p)
  , req = { uri: u, headers: h, json: true, body: d }

  if (this.token) {
    h.cookie = 'AuthSession=' + this.token.AuthSession
  }

  request[meth](req, function (er, res, data) {
    // update cookie.
    if (er || res.statusCode !== 200) return cb(er, res, data)
    addToken.call(this, res)
    return cb(er, res, data)
  }.bind(this))
}}

function login (auth, cb) {
  makeReq('post', true, true).call(this, '/_session', auth, cb)
}

function addToken (res) {
  // attach the token.
  var sc = res.headers['set-cookie']
  if (!sc) return
  if (!Array.isArray(sc)) sc = [sc]

  sc = sc.filter(function (c) {
    return c.match(/^AuthSession=/)
  })[0]

  if (!sc.length) return

  sc = sc.split(/\s*;\s*/).map(function (p) {
    return p.split('=')
  }).reduce(function (set, p) {
    var k = p[0] === 'AuthSession' ? p[0] : p[0].toLowerCase()
    , v = k === 'expires' ? Date.parse(p[1])
        : p[1] === '' || p[1] === undefined ? true // HttpOnly
        : p[1]
    set[k] = v
    return set
  }, {})

  if (sc.hasOwnProperty('max-age')) {
    var ma = sc['max-age']
    sc.expires = (ma <= 0) ? 0 : Date.now() + (ma * 1000)
    delete sc['max-age']
  }

  this.token = sc
}


function logout (cb) {
  if (!valid(this.token)) {
    this.token = null
    return process.nextTick(cb)
  }

  var h = { cookie: 'AuthSession=' + this.token.AuthSession }
  , u = url.resolve(this.couch, '/_session')
  , req = { uri: u, headers: h, json: true }

  request.del(req, function (er, res, data) {
    if (er || res.statusCode !== 200) {
      return cb(er, res, data)
    }

    this.token = null
    cb(er, res, data)
  }.bind(this))
}

function valid (token) {
  var d = token && token.expires
  return token && token.expires > Date.now()
}
