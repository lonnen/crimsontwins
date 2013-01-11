(function() {

var containerIndex = 0;
var $containers = $('.container');

function updateContents($element) {
  $prev = $containers.slice(containerIndex, containerIndex+1);
  containerIndex = (containerIndex + 1) % $containers.length;
  $next = $containers.slice(containerIndex, containerIndex+1);

  $next.html($element);

  $next.css('opacity', 1.0);
  $prev.css('opacity', 0.0);

  $prev.once('transitioned', function() {
    $prev.html('');
  });
}

function elementFor(content) {
  if (content.type == 'url') {
    return $('<iframe>', {
      sandbox: 'allow-same-origin allow-scripts allow-forms',
      src: content.url
    });
  }
  if (content.type == 'image') {
    return $('<div>', {
      'class': 'imgbg'
    }).css({
      'background-image': 'url({url})'.format(content)
    });
  }
  if (content.type == 'html') {
    return $(content.html);
  }
}

function resize() {
  $('.wrap').css({
    width: window.innerWidth,
    height: window.innerHeight
  });
}

$(function() {
  $(window).on('resize', resize);
  resize();

  $(document).keyup(function(e) {
    if (e.keyCode == 27) { // Esc
      now.reset();
    }
  });

  ready('dom');
});

readyParts = ['dom', 'now'];
function ready(part) {
  if (readyParts.indexOf(part) >= 0) {
    readyParts = _.without(readyParts, part);
    if (!readyParts.length) {
      init();
    }
  }
}

function init() {
  makeSelector();
}

function makeSelector() {
  var $selector = $('<div>', {'class': 'selector'});
  var $selectorUl = $('<ul>');

  $selector.append('<h1>Select a screen to view</h1>');
  $selector.append($selectorUl);

  var screens = now.getScreens(function(screens) {
    _.each(screens, function(screen) {
      $selectorUl.append(makeScreenPreview(screen));
    });

    $selectorUl.append(makeScreenPreview({
        name: 'New screen',
        content: {type: 'html', html: '<i class="add">'}
      }, false)
      .addClass('meta')
      .on('click', function(ev) {
        console.log('new clicked');
        ev.preventDefault();
        now.addScreen('herpderp ' + (new Date()).getMilliseconds());
      }));

    /*
    $selectorUl.append(makeScreenPreview({
        name: 'Hydra mode',
        content: {type: 'html', html: '<i class="hydra">'}
      }, false)
      .addClass('meta')
      .on('click', function(ev) {
        ev.preventDefault();
        console.log('hyrda clicked');
      }));
    */

    $('body').append($selector);
  });
}

var screenPreviewTemplate =
  '<li class="preview">' +
    '<h1>{name}</h1>' +
    '<div class="content"/>' +
  '</li>';

function makeScreenPreview(screen, events) {
  console.log(arguments);
  if (events === undefined) {
    events = true;
  }
  var $elem = $(screenPreviewTemplate.format(screen))
    .data('screen', screen)
    .attr('name', 'screen-' + screen.id);
  if (events) {
    $elem.find('.content').on('click', function(ev) {
      ev.preventDefault();
      console.log('clicked on a screen');
      selectScreen($(this).parent());
    });
    $elem.find('h1').append(
      $('<button class="close">X</button>')
        //.on('click', now.removeScreen.bind(this, screen.id)));
        .on('click', function() {
          console.log('removing screen');
          now.removeScreen(screen.id);
        }));
  }
  $elem.children('.content').html(elementFor(screen.content));
  return $elem;
}

function selectScreen($elem) {
  var screen = $elem.data('screen');
  $wrap = $('<div>', {
      'class': 'wrap',
      'name': 'screen-' + screen.id
    })
    .append($('<div class="content"/>')
      .html(elementFor(screen.content)))
    .css({
      width: window.innerWidth,
      height: window.innerHeight
    });

  $('.selector').hide();
  $('body').append($wrap);
}

/******** Now.js connections ********/
now.ready(function() {
  now.setUrl = function(url) {
    console.log('Loading url in iframe');
    updateContents(elementFor({type: 'html', url: url}));
  };

  now.setImage = function(url) {
    console.log('Loading image');
    updateContents(elementFor({type: 'image', url: url}));
  };

  now.reset = function() {
    console.log('reset');
    window.location.reload();
  };

  now.screenAdded = function(screen) {
    console.log("Adding screen: " + JSON.stringify(screen));
    $('.selector .meta').first().before(makeScreenPreview(screen));
  };

  now.screenChanged = function(screen) {
    console.log("Changing screen: " + JSON.stringify(screen));
    $preview = $('[name=screen-{id}]'.format(screen));
    $preview.find('.content').html(elementFor(screen.content));
    $preview.data('screen', screen);
  };

  now.screenRemoved = function(screen) {
    $('[name=screen-{id}]'.format(screen)).remove();
  };

  ready('now');
});

})();
