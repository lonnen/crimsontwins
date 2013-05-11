var _ = require('underscore');
var uri = require('uri-js');
var http = require('http');
var https = require('https');
var promise = require('node-promise');

var config = require('./config');
var utils = require('./utils');
var modifiers = require('./modifiers');
var io = require('./clients').getIO();


/* Manages clients, screens, and content.
 *
 * - Client: A connected web browser. Shows one or more Screens.
 * - Screen: A place for content to live. Viewed by one or more clients.
 * - Content: A thing shown on a screen.
 */

var screens = [];
var nextScreen = 0;
var contentSet = [];
var nextContent = 0;


exports.init = function() {
  loadContent().then(setupScreens);


  /* Socket.IO connections */
  io.sockets.on('connection', function(socket) {

    socket.on('addScreen', exports.addScreen);
    socket.on('removeScreen', exports.removeScreen);
    socket.on('getScreens', function(d, cb) {
      cb(_.map(screens, serializeScreen));
    });

    socket.on('getContentSet', function(d, cb) {
      cb(contentSet);
    });
    socket.on('setContentSetUrls', function(contentUrls) {
      config.resetUrls = contentUrls;
      loadContent().then(config.save());
    });
  });
}


function loadContent() {
  var promises = [];
  var p;

  contentSet = [];
  _.each(config.resetUrls, function(url) {
    p = contentForUrl(url);
    promises.push(p);
    p.then(Array.prototype.push.bind(contentSet));
  });

  return promise.all(promises);
}


function setupScreens() {
  _.each(config.screens, function(screenName) {
    exports.addScreen(screenName);
  });
}


exports.addScreen = function(name) {
  if (!name || findScreen('name', name)) {
    // Duplicate and empty names are both bad. Stop that.
    return;
  }

  var id = utils.getId();
  var screen = {
    id: id,
    name: name,
    content: {type: 'html', html: '<div>Loading...</div>'},
    resetId: null
  };

  screens.push(screen);
  cycleScreen(screen.id);
  sendScreenAdded(screen);

  config.screens = _.map(screens, function(s) { return s.name; });
  config.save();
};

exports.removeScreen = function(id) {
  var screen = findScreen('id', id);
  if (screen !== undefined) {
    clearTimeout(screen.timeout);
    screens = _.without(screens, screen);
    sendScreenRemoved(screen);

    config.screens = _.map(screens, function(s) { return s.name; });
    config.save();
  }
};

function findScreen(key, value, moveNextScreen) {
  var found, index;

  if (value === undefined) return undefined;

  if (value.toLowerCase !== undefined) {
    value = value.toLowerCase();
  }

  _.each(screens, function(s, i) {
    var screenVal = s[key];
    if (screenVal.toLowerCase !== undefined) {
      screenVal = screenVal.toLowerCase();
    }
    if (screenVal === value) {
      found = s;
      index = i;
    }
  });
  if (moveNextScreen && index === nextScreen) {
    nextScreen = (nextScreen + 1) % screens.length;
  }
  return found;
}

function cycleScreen(screen_id) {
  var screen = findScreen('id', screen_id);
  if (screen === undefined) {
    return;
  }
  screen.content = getDefaultContent();

  sendScreenChanged(screen);

  screen.timeout = setTimeout(cycleScreen.bind(null, screen_id),
    config.resetTime);
}

/* Put new content on the next screen in the line up. */
exports.setUrl = function(url, screenName) {
  var screen, p = new promise.Promise();

  if (screens.length === 0) {
    p.resolve({msg: 'No screens.'});
    return p;
  }

  if (screenName) {
    screen = findScreen('name', screenName, true);
  }
  // The above loop might fail, so check for that.
  if (screen === undefined) {
    screen = screens[nextScreen];
    nextScreen = (nextScreen + 1) % screens.length;
  }

  contentForUrl(url).then(function(content) {
    screen.content = content;
    sendScreenChanged(screen);
    clearTimeout(screen.timeout);
    screen.timeout = setTimeout(cycleScreen.bind(null, screen.id),
                                config.resetTime);

    p.resolve(content);
  }, p.reject);

  return p;
};

exports.reset = function(screenName) {
  var screen, p = new promise.Promise();

  if (screens.length === 0) {
    p.resolve({msg: 'No screens.'});
    return p;
  }

  if (screenName) {
    screen = findScreen('name', screenName, true);
  }

  if (screen === undefined) {
    _.each(screens, function(screen) {
      screen.content = getDefaultContent();
      sendScreenChanged(screen);
    });
  } else {
    screen.content = getDefaultContent();
    sendScreenChanged(screen);
  }
};

function getDefaultContent() {
  var content = contentSet[nextContent];
  if (++nextContent >= contentSet.length) {
    utils.shuffle(contentSet);
    nextContent = 0;
  }
  return content;
}

function contentForUrl(url) {
  var p = new promise.Promise();

  if (url.indexOf('://') === -1) {
    url = 'http://' + url;
  }

  var components = uri.parse(url);
  if (components.errors.length) {
    p.reject({
      message: "We couldn't parse a url from that."
    }, true);
    return p;
  }
  if (components.host === undefined) {
    p.reject({
      message: "Couldn't load URL. (Maybe a bad redirect?)"
    }, true);
    return p;
  }

  for (var i=0; i < modifiers.all.length; i++) {
    var out = modifiers.all[i]({url: url, components: components});
    if (out) {
      p.resolve(out);
      return p;
    }
  }

  var path = components.path;
  if (components.query) {
    path += '?' + components.query;
  }
  var port = components.port;

  var proto = http;
  if (components.scheme === 'https') {
    proto = https;
    port = 443;
  }

  var options = {
    method: 'HEAD',
    host: components.host,
    port: port,
    path: path
  };

  var req = proto.request(options, function(res) {
    var headers = {};
    _.each(res.headers, function(value, key) {
      headers[key.toLowerCase()] = value;
    });

    if (res.statusCode >= 300 && res.statusCode < 400) {
      // redirect, handle it.
      var newP = contentForUrl(headers.location);
      newP.then(p.resolve, function(data) { p.reject(data, true); });
      return;
    }

    if (res.statusCode >= 400) {
      p.reject({
        message: 'There was a problem with the url (' + res.statusCode + ')'
      }, true);
      return;
    }

    var contentType = (headers['content-type'] || '').toLowerCase();
    if (contentType.indexOf('image/') === 0) {
      p.resolve({
        url: url,
        type: 'image'
      });
      return;
    }

    var xframe = (headers['x-frame-options'] || '').toLowerCase();
    if (xframe === 'sameorigin' || xframe === 'deny') {
      p.reject({
        message: "That site prevents framing. It won't work."
      }, true);
      return;
    }

    p.resolve({type: 'url', url: url});
  });

  req.on('error', function(err) {
    // We'll do it live.
    p.resolve({
      type: 'url',
      url: url,
      message: "We're not sure about that, but we'll give it ago."
    });
  });

  req.end();

  return p;
}

// Screen objects store some things that can't be easily seralized. So
// don't include those.
function serializeScreen(screen) {
  return {
    'id': screen.id,
    'name': screen.name,
    'content': screen.content
  };
}

function sendScreenAdded(screen) {
  io.sockets.emit('screenAdded', serializeScreen(screen));
}

function sendScreenChanged(screen) {
  io.sockets.emit('screenChanged', serializeScreen(screen));
}

function sendScreenRemoved(screen) {
  io.sockets.emit('screenRemoved', serializeScreen(screen));
}
