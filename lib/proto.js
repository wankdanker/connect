
/*!
 * Connect - HTTPServer
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var http = require('http')
  , parse = require('url').parse
  , assert = require('assert');

// prototype

var app = module.exports = {};

// environment

var env = process.env.NODE_ENV || 'development';

/**
 * Utilize the given middleware `handle` to the given `route`,
 * defaulting to _/_. This "route" is the mount-point for the
 * middleware, when given a value other than _/_ the middleware
 * is only effective when that segment is present in the request's
 * pathname.
 *
 * For example if we were to mount a function at _/admin_, it would
 * be invoked on _/admin_, and _/admin/settings_, however it would
 * not be invoked for _/_, or _/posts_.
 *
 * This is effectively the same as passing middleware to `connect.createServer()`,
 * however provides a progressive api.
 *
 * Examples:
 *
 *      var server = connect();
 *      server.use(connect.favicon());
 *      server.use(connect.logger());
 *      server.use(connect.static(__dirname + '/public'));
 *
 * If we wanted to prefix static files with _/public_, we could
 * "mount" the `static()` middleware:
 *
 *      server.use('/public', connect.static(__dirname + '/public'));
 *
 * This api is chainable, meaning the following is valid:
 *
 *      connect.createServer()
 *        .use(connect.favicon())
 *        .use(connect.logger())
 *        .use(connect.static(__dirname + '/public'))
 *        .listen(3000);
 *
 * @param {String|Function} route or handle
 * @param {Function} handle
 * @return {Server}
 * @api public
 */

app.use = function(route, handle){
  this.route = '/';

  // default route to '/'
  if ('string' != typeof route) {
    handle = route;
    route = '/';
  }

  // wrap sub-apps
  if ('function' == typeof handle.handle) {
    var server = handle;
    handle.route = route;
    handle = function(req, res, next){
      server.handle(req, res, next);
    };
  }

  // wrap vanilla http.Servers
  if (handle instanceof http.Server) {
    handle = handle.listeners('request')[0];
  }

  // normalize route to not trail with slash
  if ('/' == route[route.length - 1]) {
    route = route.substr(0, route.length - 1);
  }

  // add the middleware
  this.stack.push({ route: route, handle: handle });

  // allow chaining
  return this;
};

/**
 * Handle server requests, punting them down
 * the middleware stack.
 *
 * @api private
 */

app.handle = function(req, res, out) {
  var writeHead = res.writeHead
    , stack = this.stack
    , removed = ''
    , index = 0;

  function next(err) {
    var layer, path, status, c;
    req.url = removed + req.url;
    req.originalUrl = req.originalUrl || req.url;
    removed = '';

    // next(status) support
    if ('number' == typeof err) {
      status = err;
      err = new Error(http.STATUS_CODES[status]);
      err.status = status;
    }

    // next callback
    layer = stack[index++];

    // all done
    if (!layer || res.headerSent) {
      // delegate to parent
      if (out) return out(err);

      // unhandled error
      if (err) {
        // default to 500
        if (res.statusCode < 400) res.statusCode = 500;

        // respect err.status
        if (err.status) res.statusCode = err.status;

        // production gets a basic error message
        var msg = 'production' == env
          ? http.STATUS_CODES[res.statusCode]
          : err.stack || err.toString();

        // log to stderr in a non-test env
        if ('test' != env) console.error(err.stack || err.toString());
        if (res.headerSent) return req.socket.destroy();
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Length', Buffer.byteLength(msg));
        if ('HEAD' == req.method) return res.end();
        res.end(msg);
      } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        if ('HEAD' == req.method) return res.end();
        res.end('Cannot ' + req.method + ' ' + req.url);
      }
      return;
    }

    try {
      path = parse(req.url).pathname;
      if (undefined == path) path = '/';

      // skip this layer if the route doesn't match.
      if (0 != path.indexOf(layer.route)) return next(err);

      c = path[layer.route.length];
      if (c && '/' != c && '.' != c) return next(err);

      // Call the layer handler
      // Trim off the part of the url that matches the route
      removed = layer.route;
      req.url = req.url.substr(removed.length);

      // Ensure leading slash
      if ('/' != req.url[0]) req.url = '/' + req.url;

      var arity = layer.handle.length;
      if (err) {
        if (arity === 4) {
          layer.handle(err, req, res, next);
        } else {
          next(err);
        }
      } else if (arity < 4) {
        layer.handle(req, res, next);
      } else {
        next();
      }
    } catch (e) {
      if (e instanceof assert.AssertionError) {
        console.error(e.stack + '\n');
        next(e);
      } else {
        next(e);
      }
    }
  }
  next();
};
