var request = require('request')
, url = require('url')
, crypto = require('crypto')

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
, changePass: changePass
, signup: signup
, deleteAccount: deleteAccount
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
      if (!body) cb = d, d = null
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

function changePass (auth, cb) {
  if (!auth.name || !auth.password) return cb(new Error('invalid auth'))

  var u = '/_users/org.couchdb.user:' + auth.name
  this.get(u, function (er, res, data) {
    if (er || res.statusCode !== 200) return cb(er, res, data)

    var newSalt = crypto.randomBytes(30).toString('hex')
    , newPass = auth.password
    , newSha = sha(newPass + newSalt)

    data.password_sha = newSha
    data.salt = newSalt
    this.put(u + '?rev=' + data._rev, data, function (er, res, data) {
      if (er || res.statusCode >= 400) return cb(er, res, data)
      this.login(auth, cb)
    }.bind(this))
  }.bind(this))
}

// They said that there should probably be a warning before
// deleting the user's whole account, so here it is:
//
// WATCH OUT!
function deleteAccount (name, cb) {
  var u = '/_users/org.couchdb.user:' + name
  this.get(u, thenPut.bind(this))

  function thenPut (er, res, data) {
    if (er || res.statusCode !== 200) {
      return cb(er, res, data)
    }

    // user accts can't be just DELETE'd by non-admins
    // so we take the existing doc and just slap a _deleted
    // flag on it to fake it.  Works the same either way
    // in couch.
    data._deleted = true
    this.put(u + '?rev=' + data._rev, data, cb)
  }
}



function signup (auth, cb) {
  if (this.token) return this.logout(function (er, res, data) {
    if (er || res.statusCode !== 200) {
      return cb(er, res, data)
    }

    if (this.token) {
      return cb(new Error('failed to delete token'), res, data)
    }

    this.signup(auth, cb)
  }.bind(this))

  // make a new user record.
  var newSalt = crypto.randomBytes(30).toString('hex')
  , newSha = sha(auth.password + newSalt)
  , user = { _id: 'org.couchdb.user:' + auth.name
           , name: auth.name
           , roles: []
           , type: 'user'
           , password_sha: newSha
           , salt: newSalt
           , date: new Date().toISOString() }

  Object.keys(auth).forEach(function (k) {
    if (k === 'name' || k === 'password') return
    user[k] = auth[k]
  })

  var u = '/_users/' + user._id
  makeReq('put', true, true).call(this, u, user, function (er, res, data) {
    if (er || res.statusCode >= 400) {
      return cb(er, res, data)
    }

    // it worked! log in as that user
    this.login(auth, function (er, res, data) {
      cb(er, res, data)
    })
  }.bind(this))
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

function sha (s) {
  return crypto.createHash("sha1").update(s).digest("hex")
}
