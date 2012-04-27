var tap = require('tap')
, CouchLogin = require('../couch-login.js')

// Yeah, go ahead and abuse my staging server, whatevs.

var auth = { name: 'testuser', password: 'test' }
, couch = new CouchLogin('https://isaacs-staging.ic.ht/')
, u = '/_users/org.couchdb.user:' + auth.name
, userRecordMarker


function okStatus (t, res) {
  var x = { found: res.statusCode, wanted: 'around 200' }
  var r = res.statusCode
  x.ok = (r >= 200 && r < 300)
  return t.ok(x.ok, 'Status code should be 200-ish', x)
}

tap.test('login', function (t) {
  couch.login(auth, function (er, res, data) {
    if (er) throw er
    okStatus(t, res)
    t.deepEqual(data, { ok: true, name: 'testuser', roles: [] })
    t.ok(couch.token)
    t.deepEqual(couch.token,
      { AuthSession: couch.token.AuthSession,
        version: '1',
        expires: couch.token.expires,
        path: '/',
        httponly: true })
    t.ok(couch.token, 'has token')
    t.end()
  })
})

var userRecord
tap.test('get', function (t) {
  couch.get(u, function (er, res, data) {
    if (er) throw er
    t.ok(data, 'data')
    t.ok(couch.token, 'token')
    userRecord = data
    okStatus(t, res)
    t.end()
  })
})

var userRecordMarker = require('crypto').randomBytes(30).toString('base64')
tap.test('add key to user record', function (t) {
  userRecord.testingCouchLogin = userRecordMarker
  var revved = u + '?rev=' + userRecord._rev
  couch.put(revved, userRecord, function (er, res, data) {
    if (er) throw er
    okStatus(t, res)
    t.ok(data, 'data')
    t.ok(couch.token, 'token')
    // get again so we have the current rev
    couch.get(u, function (er, res, data) {
      if (er) throw er
      okStatus(t, res)
      t.equal(data.testingCouchLogin, userRecord.testingCouchLogin)
      userRecord = data
      t.end()
    })
  })
})

tap.test('remove key', function (t) {
  var revved = u + '?rev=' + userRecord._rev
  delete userRecord.testingCouchLogin
  couch.put(revved, userRecord, function (er, res, data) {
    if (er) throw er
    okStatus(t, res)
    t.ok(data, 'data')
    t.ok(couch.token, 'token')
    t.equal(data.testingCouchLogin, undefined)
    userRecord = data
    t.end()
  })
})

tap.test('logout', function (t) {
  couch.logout(function (er, res, data) {
    if (er) throw er
    okStatus(t, res)
    t.ok(data, 'data')
    t.notOk(couch.token, 'token')
    t.end()
  })
})

// now try some logged out monkey business!
tap.test('logged out post', function (t) {
  couch.post('/yeah-right', {foo: 100}, function (er, res, data) {
    t.ok(er, 'should get an error')
    t.notOk(couch.token, 'token')
    t.end()
  })
})
