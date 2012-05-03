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

function decorate (req, res) {
  req.couch = res.couch = this

  // backed by some sort of set(k,v,cb), get(k,cb) session storage.
  var session = req.session || res.session || null
  if (session) {
    this.tokenGet = function (cb) {
      session.get('couch_token', cb)
    }

    // don't worry about it failing.  it'll just mean a login next time.
    this.tokenSet = function (tok, cb) {
      session.set('couch_token', tok, cb || function () {})
    }

    this.tokenDel = function (cb) {
      session.del('couch_token', cb || function () {})
    }
  }

  return this
}

CouchLogin.prototype =
{ get: makeReq('get')
, del: makeReq('del')
, put: makeReq('put', true)
, post: makeReq('post', true)
, login: login
, logout: logout
, decorate: decorate
}

Object.defineProperty(CouchLogin.prototype, 'constructor',
  { value: CouchLogin, enumerable: false })

function makeReq (meth, body, f) { return function madeReq (p, d, cb) {
  if (!f && !valid(this.token)) {
    // lazily get the token.
    if (this.tokenGet) return this.tokenGet(function (er, tok) {
      if (er || !valid(tok)) {
        return cb(new Error('auth token expired or invalid'))
      }
      this.token = tok
      return madeReq.call(this, p, d, cb)
    }.bind(this))

    // no getter, no token, no business.
    return process.nextTick(function () {
      cb(new Error('auth token expired or invalid'))
    })
  }

  if (!body) cb = d, d = null

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
  // attach the token, if a new one was provided.
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
  if (this.tokenSet) this.tokenSet(this.token)
}


function logout (cb) {
  if (!this.token && this.tokenGet) {
    return this.tokenGet(function (er, tok) {
      if (er || !tok) return cb()
      this.token = tok
      this.logout(cb)
    }.bind(this))
  }

  if (!valid(this.token)) {
    this.token = null
    if (this.tokenDel) this.tokenDel()
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
    if (this.tokenDel) this.tokenDel()
    cb(er, res, data)
  }.bind(this))
}

function valid (token) {
  var d = token && token.expires
  return token && token.expires > Date.now()
}
