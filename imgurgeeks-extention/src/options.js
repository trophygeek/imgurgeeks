'use strict';

function save_options() {
  try {
    // clone
    let items = Object.assign({}, DEFAULT_SETTINGS);  // stupid syntax.

    // todo: make more generic
    items['show_defer_post_ui'] = document.getElementById('show_defer_post_ui').checked;


    // only set the ones that are NOT equal to the default.
    let items_to_save = {};
    for (const [key, val] of Object.entries(items)) {
      // MORE stupidity because deep object comparison doesn't exist?!?
      if (JSON.stringify(val) !== JSON.stringify(DEFAULT_SETTINGS[key])) {
        items_to_save[key] = val;
      }
    }

    // each item gets it's own key. delete what's there and add anything that's not the default value.
    chrome.storage.local.clear(function() {
      if (Object.keys(items_to_save).length > 0) {
        chrome.storage.local.set(items_to_save);
      }
    });

  } catch (err) {
    debugger;
  }
}

function reset_options() {
  chrome.storage.local.clear(function() {
    Refresh();
  });
}

function Refresh() {
  chrome.storage.local.get(DEFAULT_SETTINGS, function (settings) {
    document.getElementById('show_defer_post_ui').checked = settings.show_defer_post_ui;
   // do other settings. Don't forget to edit DEFAULT_SETTINGS
  });
}

function init_options() {

  document.addEventListener('click', async (e) => {
    try {
      if (e.target === null || e.target.id === null) {
        return;
      }
      const targetid = e.target.id;

      if (targetid === 'reset_to_defaults') {
        reset_options();
      }

      save_options();

    } catch (err) {
      debugger;
    }
  });

  document.addEventListener('change', async (e) => {
    save_options();
  });

  // initial load
  Refresh();
}

document.addEventListener('DOMContentLoaded', init_options);
