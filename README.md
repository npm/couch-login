# couch-login

This module lets you log into couchdb to get a session token, then make
requests using that session.  It is basically just a thin wrapper around
[@mikeal's request module](https://github.com/mikeal/request).

This is handy if you want a user to take actions in a couchdb database
on behalf of a user, without having to store their couchdb username and
password anywhere.  (You do need to store the AuthSession token
somewhere, though.)

## Usage

```javascript
var CouchLogin = require('couch-login')

// Nothing about this module is http-server specific of course.
// You could also use it to do authenticated requests against
// a couchdb using sessions and storing the token somewhere else.

http.createServer(function (req, res) {
  var couch = new CouchLogin('http://my-couch.iriscouch.com:5984/')

  // .. look up the token in the user's session or whatever ..

  if (sessionToken) {
    // this user already logged in.
    req.couch.token = sessionToken

    // now we can do things on their behalf, like:
    // 1. View their session info.
    // like doing request.get({ uri: couch + '/_session', ... })
    // but with the cookie and whatnot

    req.couch.get('/_session', function (er, resp, data) {
      // er = some kind of communication error.
      // resp = response object from the couchdb request.
      // data = parsed JSON response body.
      if (er || resp.statusCode !== 200) {
        res.statusCode = resp.statusCode || 403
        return res.end('Invalid login or something')
      }

      // now we have the session info, we know who this user is.
      // hitting couchdb for this on every request is kinda costly,
      // so maybe you should store the username wherever you're storing
      // the sessionToken.  RedSess is a good util for this, if you're
      // into redis.  And if you're not into redis, you're crazy,
      // because it is awesome.

      // now let's get the user record.
      // note that this will 404 for anyone other than the user,
      // unless they're a server admin.
      req.couch.get('/_users/org.couchdb.user:' + data.userCtx.name, etc)

      // PUTs and DELETEs will also use their session, of course, so
      // your validate_doc_update's will see their info in userCtx
    })

  } else {
    // don't have a sessionToken.
    // get a username and password from the post body or something.
    // maybe redirect to a /login page or something to ask for that.
    var login = { name: name, password: password }
    req.couch.login(login, function (er, resp, data) {
      // again, er is an error, resp is the response obj, data is the json
      if (er || resp.statusCode !== 200) {
        res.statusCode = resp.statusCode || 403
        return res.end('Invalid login or something')
      }

      // the data is something like
      // {"ok":true,"name":"testuser","roles":[]}
      // and req.couch.token is the token you'll need to save somewhere.

      // at this point, you can start making authenticated requests to
      // couchdb, or save data in their session, or do whatever it is
      // that you need to do.

      res.statusCode = 200
      res.write("Who's got two thumbs and just logged you into couch?\n")
      setTimeout(function () {
        res.end("THIS GUY!")
      }, 500)
    })
  }
})
```

## Class: CouchLogin
### new CouchLogin(couchdbUrl)

Create a new CouchLogin object bound to the couchdb url.

In addition to these, the `get`, `post`, `put`, and `del` methods all
proxy to the associated method on [request](https://github.com/mikeal/request).

However, as you'll note in the example above, only the pathname portion
of the url is required.  Urls will be appended to the couchdb url passed
into the constructor.

If you have to talk to more than one couchdb, then you'll need more than
one CouchLogin object, for somewhat obvious reasons.

All callbacks get called with the following arguments, which are exactly
identical to the arguments passed to a `request` callback.

* `er` {Error | null} Set if a communication error happens.
* `resp` {HTTP Response} The response from the request to couchdb
* `data` {Object} The parsed JSON data from couch

### couch.token

* {Object}

An object representing the couchdb session token.  (Basically just a
cookie and a timeout.)

If the token has already timed out, then setting it will have no effect.

### couch.login(auth, callback)

* `auth` {Object} The login details
  * `name` {String}
  * `password` {String}
* `callback` {Function}

When the callback is called, the `couch.token` will already have been
set (assuming it worked!), so subsequent requests will be done as that
user.

### couch.get(path, callback)

GET the supplied path from the couchdb using the credentials on the
token.

Fails if the token is invalid or expired.

### couch.del(path, callback)

DELETE the supplied path from the couchdb using the credentials on the
token.

Fails if the token is invalid or expired.

### couch.post(path, data, callback)

POST the data to the supplied path in the couchdb, using the credentials
on the token.

Fails if the token is invalid or expired.

### couch.put(path, data, callback)

PUT the data to the supplied path in the couchdb, using the credentials
on the token.

Fails if the token is invalid or expired.

### couchdb.logout(callback)

Delete the session out of couchdb.  This makes the token permanently
invalid.
